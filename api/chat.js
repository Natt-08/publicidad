import { GoogleGenAI } from '@google/genai';
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

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en Vercel.' });
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  try {
    // 1. Cargar las 300 campañas COMPLETAS
    const filePath = join(process.cwd(), 'campanas.json');
    const fileData = readFileSync(filePath, 'utf8');
    const todasLasCampanas = JSON.parse(fileData);

    // 2. Prompt con toda la data junta (Gemini se come 1 millón de tokens sin pestañear)
    const promptSistema = `
Eres un Director Creativo General y Jurado Presidente de festivales publicitarios como Cannes Lions.
Tienes acceso a nuestra base de datos COMPLETA con todas las campañas cargadas (tanto ganadoras de metales como no ganadoras o finalistas):

BASE DE DATOS COMPLETA:
${JSON.stringify(todasLasCampanas)}

TU FORMA DE RESPONDER Y PELOTEAR:
1. Tienes visión analítica y creativa superior. Compara patrones reales en insights, tipos de ideas y ejecuciones entre lo que ganó y lo que se quedó fuera.
2. Responde como una dupla de peloteo creativo: directo, apasionado, crítico y sin rodeos corporativos.
3. Cita OBLIGATORIAMENTE nombres reales de piezas de la base, explicando por qué funcionaron o por qué fallaron frente al jurado.
4. Si el usuario te tira un brief o pregunta, proponle caminos conceptuales arriesgados y devuélvele la pelota con una pregunta clave para seguir construyendo.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: `${promptSistema}\n\nPregunta / Brief del usuario: ${mensaje}` }
          ]
        }
      ],
      config: {
        temperature: 0.7,
      }
    });

    const textoRespuesta = response.text || 'Sin respuesta generada.';
    return res.status(200).json({ respuesta: textoRespuesta });

  } catch (error) {
    console.error('Error detallado:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
