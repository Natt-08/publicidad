import { Groq } from 'groq-sdk';
import { readFileSync } from 'fs';
import { join } from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { mensaje } = req.body || {};
  if (!mensaje) {
    return res.status(400).json({ error: 'Falta el mensaje en la consulta.' });
  }

  // Verificación preventiva de la clave
  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar GROQ_API_KEY en las Environment Variables de Vercel.' });
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  try {
    // Lectura del JSON en la raíz del entorno Vercel
    const filePath = join(process.cwd(), 'campanas.json');
    let campanas = [];
    try {
      const fileData = readFileSync(filePath, 'utf8');
      campanas = JSON.parse(fileData);
    } catch (err) {
      return res.status(500).json({ error: `No se pudo leer campanas.json: ${err.message}` });
    }

    // Filtrar/compactar para cuidar la ventana de tokens
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
Eres un estratega y director creativo senior experto en festivales publicitarios.
Tienes acceso a esta base de campañas premiadas:
${JSON.stringify(datosCompactos)}

INSTRUCCIONES:
1. Responde a la pregunta del usuario con profundidad analítica e inspiración publicitaria.
2. Cita OBLIGATORIAMENTE ejemplos concretos de la base suministrada que justifiquen tu respuesta.
3. Para cada caso mencionado incluye: Nombre de la pieza, Marca, Festival/Año/Metal, insight, idea y su LINK.
4. Mantén un tono creativo, directo y profesional.
`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: promptSistema },
        { role: 'user', content: mensaje }
      ],
      model: 'openai/gpt-oss-120b',
      temperature: 0.7,
      max_completion_tokens: 2048,
      stream: true,
      reasoning_effort: 'medium'
    });

    let respuestaFinal = '';
    for await (const chunk of chatCompletion) {
      respuestaFinal += chunk.choices[0]?.delta?.content || '';
    }

    return res.status(200).json({ respuesta: respuestaFinal || 'El modelo no devolvió texto.' });

  } catch (error) {
    console.error('Error detallado:', error);
    return res.status(500).json({ error: error.message || 'Error desconocido en el servidor.' });
  }
}
