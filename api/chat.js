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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en Vercel.' });
  }

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

    // Modelos activos de tu panel ordenados por mayor cuota disponible (500 RPD primero)
    const modelos = [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.7-flash',
      'gemini-3.8-flash'
    ];

    let respuestaTexto = null;
    let errores = [];

    for (const mod of modelos) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${mod}:generateContent?key=${apiKey}`;
        
        const payload = {
          contents: [
            {
              role: 'user',
              parts: [{ text: `${promptSistema}\n\nPregunta del creativo: ${mensaje}` }]
            }
          ],
          generationConfig: {
            temperature: 0.7
          }
        };

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
          respuestaTexto = data.candidates[0].content.parts[0].text;
          break;
        } else {
          errores.push(`${mod}: ${data.error?.message || response.statusText}`);
        }
      } catch (err) {
        errores.push(`${mod}: ${err.message}`);
      }
    }

    if (!respuestaTexto) {
      return res.status(500).json({ 
        error: `No se pudo obtener respuesta de ningún modelo. Detalle de intentos:\n${errores.join('\n')}` 
      });
    }

    return res.status(200).json({ respuesta: respuestaTexto });

  } catch (error) {
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
