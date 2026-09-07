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
    return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en Vercel.' });
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

    // Lista rotativa en cascada: si uno falla o deja de existir, prueba el siguiente
    const modelosDisponibles = [
      'gemini-3.6-flash',
      'gemini-2.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-pro'
    ];

    let respuesta = null;
    let ultimoError = null;

    for (const nombreModelo of modelosDisponibles) {
      try {
        console.log(`Intentando conectar con modelo: ${nombreModelo}`);
        const model = genAI.getGenerativeModel({
          model: nombreModelo,
          systemInstruction: promptSistema
        });

        const result = await model.generateContent(mensaje);
        respuesta = result.response.text();
        
        // Si generó texto con éxito, cortamos el bucle
        if (respuesta) break;
      } catch (err) {
        console.warn(`Falló ${nombreModelo}: ${err.message}. Probando siguiente opción...`);
        ultimoError = err;
      }
    }

    if (!respuesta) {
      throw new Error(`Ningún modelo de la lista respondió. Último error: ${ultimoError?.message}`);
    }

    return res.status(200).json({ respuesta });

  } catch (error) {
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
