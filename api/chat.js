import { Groq } from 'groq-sdk';
import { readFileSync } from 'fs';
import { join } from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { mensaje } = req.body || {};
  if (!mensaje) {
    return res.status(400).json({ error: 'Falta el mensaje' });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: 'Falta la variable GROQ_API_KEY en Vercel.' });
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  try {
    const filePath = join(process.cwd(), 'campanas.json');
    const fileData = readFileSync(filePath, 'utf8');
    const campanas = JSON.parse(fileData);

    // Separar en ganadoras y no ganadoras
    const esGanadora = (c) => {
      const metal = (c.METAL || c.metal || '').toLowerCase();
      return metal.includes('gold') || metal.includes('oro') || 
             metal.includes('silver') || metal.includes('plata') || 
             metal.includes('bronze') || metal.includes('bronce') || 
             metal.includes('grand prix') || metal.includes('gp') ||
             metal.includes('titanium');
    };

    const formatear = (c) => ({
      pieza: c.TITULO_PIEZA || c.titulo_pieza || '',
      marca: c.MARCA || c.marca || '',
      resultado: c.METAL || c.metal || 'No Ganadora / Shortlist',
      festival: `${c.FESTIVAL || c.festival || ''} ${c.ANIO || c.anio || ''}`,
      insight: c.insight_problema || c.insight || '',
      idea: c.idea_ejecucion || c.idea || '',
      link: c.LINK || c.link || ''
    });

    const ganadoras = campanas.filter(esGanadora).map(formatear);
    const noGanadoras = campanas.filter(c => !esGanadora(c)).map(formatear);

    // Tomar una muestra representativa de cada lado (máximo 8 de cada una = 16 casos total)
    // Esto gasta solo ~3.000 tokens: velocidad ultra rápida y 0 riesgo de saturación
    const muestraGanadoras = ganadoras.slice(0, 8);
    const muestraNoGanadoras = noGanadoras.slice(0, 8);

    const promptSistema = `
Eres mi dupla creativa senior y jurado experimentado de Cannes Lions.
Tienes sobre la mesa una muestra real de piezas de nuestra base de datos dividida en dos grupos:

PIEZAS GANADORAS (Metales / Grand Prix):
${JSON.stringify(muestraGanadoras)}

PIEZAS NO GANADORAS (Shortlist / Sin premio):
${JSON.stringify(muestraNoGanadoras)}

TU MISIÓN DE PELOTEO:
1. Compara con ojo crítico de jurado ambos grupos:
   - ¿Qué tienen los insights de las ganadoras que les faltó a las no ganadoras? (¿Tensión real vs. obviedad? ¿Frescura vs. cliché?)
   - ¿En la ejecución, qué hizo que una pasara el corte y la otra se quedara a medio camino?
2. Cita ejemplos CONCRETOS con nombres de piezas de ambos grupos para contrastarlas cara a cara.
3. Habla como dupla creativa: con criterio filoso, sin rodeos corporativos y devolviendo la pelota con un aprendizaje clave que podamos aplicar a nuestro próximo brief.
`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: promptSistema },
        { role: 'user', content: mensaje }
      ],
      model: 'openai/gpt-oss-120b',
      temperature: 0.7,
      max_completion_tokens: 1500,
      stream: true,
      reasoning_effort: 'medium'
    });

    let respuestaFinal = '';
    for await (const chunk of chatCompletion) {
      respuestaFinal += chunk.choices[0]?.delta?.content || '';
    }

    return res.status(200).json({ respuesta: respuestaFinal || 'Sin respuesta generada.' });

  } catch (error) {
    console.error('Error detallado:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
