import { GoogleGenerativeAI } from '@google/generative-ai';
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

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en las variables de entorno de Vercel.' });
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  try {
    const filePath = join(process.cwd(), 'campanas.json');
    const fileData = readFileSync(filePath, 'utf8');
    const todasLasCampanas = JSON.parse(fileData);

    const promptSistema = `
Eres un Director Creativo General y jurado experimentado de Cannes Lions.
Tienes sobre la mesa nuestra base de datos COMPLETA con todas las campañas (ganadoras de metales y no ganadoras/shortlists):

BASE DE DATOS COMPLETA:
${JSON.stringify(todasLasCampanas)}

TU MISIÓN EN ESTE PING-PONG CREATIVO:
1. Analiza y compara patrones reales en los insights, ejecuciones y propuestas entre las que ganaron metales y las que no.
2. Habla como una dupla creativa: con criterio crítico, apasionado, cero rodeos y lenguaje publicitario auténtico.
3. Cita nombres específicos de campañas de la base para sustentar tus puntos.
4. Si el usuario te presenta un reto o brief, dale giros conceptuales y cierra siempre devolviendo la pelota con una pregunta clave.
`;

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash',
      systemInstruction: promptSistema
    });

    const result = await model.generateContent(mensaje);
    const respuesta = result.response.text();

    return res.status(200).json({ respuesta: respuesta || 'Sin respuesta.' });

  } catch (error) {
    console.error('Error detallado:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
