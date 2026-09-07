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

    // Compresión drástica de tokens manteniendo el 100% del valor conceptual
    const baseCompacta = todasLasCampanas.map(c => {
      const metal = c.METAL || c.metal || 'NO GANADORA / SHORTLIST';
      const festival = `${c.FESTIVAL || c.festival || 'Festival'} ${c.ANIO || c.anio || ''}`.trim();
      const pieza = c.TITULO_PIEZA || c.titulo_pieza || 'S/T';
      const marca = c.MARCA || c.marca || 'S/M';
      const cat = c.CATEGORIA || c.categoria || '';
      const insight = c.insight_problema || c.insight || '';
      const idea = c.idea_ejecucion || c.idea || '';
      const link = c.LINK || c.link || '';

      return `[${metal.toUpperCase()} | ${festival} | ${cat}] "${pieza}" (${marca})\n- Insight: ${insight}\n- Idea: ${idea}${link ? `\n- Link: ${link}` : ''}`;
    }).join('\n---\n');

    const promptSistema = `
Eres un Director Creativo General y Jurado Presidente de Cannes Lions.
Estamos en una sesión de peloteo creativo cara a cara. Tienes acceso a nuestra base COMPLETA con todas las campañas cargadas (ganadoras de metales y no ganadoras/shortlists):

${baseCompacta}

TU MISIÓN EN ESTE PING-PONG CREATIVO:
1. Analiza y compara patrones reales en los insights, ejecuciones y audacia entre las que ganaron metales frente a las que no pasaron o quedaron en shortlist.
2. Habla como una dupla creativa: con criterio filoso, apasionado, sin rodeos corporativos y lenguaje de agencia.
3. Cita nombres específicos de campañas de la base (ganadoras y no ganadoras) para fundamentar tus observaciones.
4. Si el usuario te tira un brief o pregunta, proponle caminos arriesgados y devuélvele la pelota con una pregunta provocadora para seguir construyendo.
`;

    // Modelos activos de tu cuenta ordenados por cuota
    const modelos = [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.7-flash',
      'gemini-3.8-flash'
    ];

    let respuestaTexto = null;
    let errorDetalle = null;

    for (const mod of modelos) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${mod}:generateContent?key=${apiKey}`;
        
        const payload = {
          contents: [
            {
              role: 'user',
              parts: [{ text: `${promptSistema}\n\nBrief o pregunta del creativo: ${mensaje}` }]
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
          errorDetalle = data.error?.message || response.statusText;
          // Si el error es por cuota o rate limit, no spameamos los otros modelos de golpe
          if (response.status === 429) {
            break;
          }
        }
      } catch (err) {
        errorDetalle = err.message;
      }
    }

    if (!respuestaTexto) {
      return res.status(500).json({ 
        error: `Error al procesar: ${errorDetalle}` 
      });
    }

    return res.status(200).json({ respuesta: respuestaTexto });

  } catch (error) {
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
