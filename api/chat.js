import { Groq } from 'groq-sdk';
import fs from 'fs';
import path from 'path';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { mensaje } = req.body;
  if (!mensaje) {
    return res.status(400).json({ error: 'Falta el mensaje' });
  }

  try {
    // 1. Cargar el JSON con las campañas
    const filePath = path.join(process.cwd(), 'campanas.json');
    const fileData = fs.readFileSync(filePath, 'utf8');
    const campanas = JSON.parse(fileData);

    // 2. Reducir campos para evitar exceder límites de tokens
    const datosCompactos = campanas.map(c => ({
      pieza: c.TITULO_PIEZA || c.titulo_pieza || '',
      marca: c.MARCA || c.marca || '',
      festival: `${c.FESTIVAL || c.festival || ''} ${c.ANIO || c.anio || ''} (${c.METAL || c.metal || ''})`,
      categoria: c.CATEGORIA || c.categoria || '',
      insight: c.insight_problema || c.insight || '',
      idea: c.idea_ejecucion || c.idea || '',
      link: c.LINK || c.link || ''
    }));

    const promptSistema = `
Eres un estratega y director creativo publicitario experto en festivales.
Tienes acceso a esta base de campañas ganadoras:
${JSON.stringify(datosCompactos)}

INSTRUCCIONES:
1. Responde a la pregunta del usuario con visión estratégica e inspiración.
2. Cita obligatoriamente casos específicos de la base provista que resuelvan la duda.
3. Para cada caso incluye: Nombre de la pieza, Marca, Festival/Año/Metal, insight, idea y su LINK.
`;

    // 3. Llamada idéntica a tu fragmento oficial
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: promptSistema },
        { role: 'user', content: mensaje }
      ],
      model: "openai/gpt-oss-120b",
      temperature: 1,
      max_completion_tokens: 2048,
      top_p: 1,
      stream: true,
      reasoning_effort: "medium",
      stop: null
    });

    // 4. Juntar los pedazos (chunks) del stream antes de responder
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
