import Groq from 'groq-sdk';
import campanas from '../campanas.json' assert { type: 'json' };

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
    const promptSistema = `
    Eres un estratega y director creativo senior experto en festivales publicitarios.
    Tienes acceso a esta base exclusiva de campañas ganadoras:
    ${JSON.stringify(campanas)}

    INSTRUCCIONES:
    1. Responde a la pregunta del usuario inspirándolo y resolviendo su duda de forma estratégica.
    2. Cita OBLIGATORIAMENTE ejemplos específicos de la base de datos que se ajusten al brief o duda.
    3. Para cada caso mencionado, incluye: Nombre de la pieza, Marca, Festival, Año, Metal, el insight/problema, la idea/ejecución y su LINK.
    4. Habla con tono creativo, directo y motivador.
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
    res.status(200).json({ respuesta });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al conectar con Groq' });
  }
}