import Groq from 'groq-sdk';
import fs from 'fs';
import path from 'path';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export default async function handler(req, res) {
  // Configuración de encabezados CORS y método
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { mensaje } = req.body;
  if (!mensaje) {
    return res.status(400).json({ error: 'Falta el mensaje' });
  }

  try {
    // 1. Cargar la base de datos de campañas de forma segura
    const filePath = path.join(process.cwd(), 'campanas.json');
    const fileData = fs.readFileSync(filePath, 'utf8');
    const campanas = JSON.parse(fileData);

    // 2. Compactar campos para optimizar el consumo de tokens
    const datosCompactos = campanas.map(c => ({
      pieza: c.TITULO_PIEZA || c.titulo_pieza || '',
      marca: c.MARCA || c.marca || '',
      festival: `${c.FESTIVAL || c.festival || ''} ${c.ANIO || c.anio || ''} (${c.METAL || c.metal || ''})`,
      categoria: c.CATEGORIA || c.categoria || '',
      insight: c.insight_problema || c.insight || '',
      idea: c.idea_ejecucion || c.idea || '',
      link: c.LINK || c.link || ''
    }));

    // 3. Prompt de sistema especializado
    const promptSistema = `
Eres un estratega y director creativo senior experto en festivales publicitarios.
Tienes acceso a esta base de datos curada con campañas ganadoras:
${JSON.stringify(datosCompactos)}

INSTRUCCIONES:
1. Responde a la pregunta del usuario con visión estratégica, profundidad e inspiración publicitaria.
2. Es OBLIGATORIO citar ejemplos específicos de la base de datos que sirvan como referencia directa para la duda o brief planteado.
3. Para cada caso mencionado, incluye siempre:
   - Nombre de la pieza
   - Marca
   - Festival, Año y Metal
   - El insight o reto
   - La idea o ejecución clave
   - El enlace de referencia (LINK) si está disponible.
4. Mantén un tono creativo, directo, profesional y claro.
`;

    // 4. Llamada a la API de Groq
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: promptSistema },
        { role: 'user', content: mensaje }
      ],
      model: 'openai/gpt-oss-120b',
      temperature: 0.4,
      max_completion_tokens: 1024,
    });

    const respuesta = chatCompletion.choices[0]?.message?.content || 'No se obtuvo respuesta del modelo.';
    return res.status(200).json({ respuesta });

  } catch (error) {
    console.error('Error detallado en la API:', error);
    return res.status(500).json({ 
      error: error.message || 'Error interno al procesar la solicitud' 
    });
  }
}
