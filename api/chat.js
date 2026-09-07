import Groq from 'groq-sdk';
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
    // Lectura segura del archivo JSON en Vercel
    const filePath = path.join(process.cwd(), 'campanas.json');
    const fileData = fs.readFileSync(filePath, 'utf8');
    const campanas = JSON.parse(fileData);

    const promptSistema = `
    Eres un estratega y director creativo senior experto en festivales publicitarios.
    Tienes acceso a esta base de campañas ganadoras:
    ${JSON.stringify(campanas)}

    INSTRUCCIONES:
    1. Responde a la pregunta del usuario con profundidad estratégica e inspiración.
    2. Cita OBLIGATORIAMENTE ejemplos específicos de la base de datos que se ajusten a la consulta.
    3. Para cada caso mencionado incluye: Nombre de la pieza, Marca, Festival, Año, Metal, el insight/problema, la idea/ejecución y su LINK.
    4. Habla con tono creativo, directo y profesional.
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: promptSistema },
        { role: 'user', content: mensaje }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.5,
    });

    const respuesta = chatCompletion.choices[0]?.message?.content || "No pude generar una respuesta.";
    return res.status(200).json({ respuesta });
  } catch (error) {
    console.error('Error detallado:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
