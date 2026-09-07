import { readFileSync } from 'fs';
import { join } from 'path';

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { mensaje } = req.body || {};
  if (!mensaje) {
    return res.status(400).json({ error: 'Falta el mensaje en la consulta.' });
  }

  const headerKey = req.headers['x-user-key'];
  const userKey = (typeof headerKey === 'string' && headerKey.trim().length > 0) ? headerKey.trim() : null;
  const headerProvider = req.headers['x-user-provider'];

  const apiKey = userKey || process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ 
      error: 'No se detectó API Key. Configúrala en el botón de ajustes (⚙️) o en Vercel.' 
    });
  }

  try {
    const filePath = join(process.cwd(), 'campanas.json');
    const fileData = readFileSync(filePath, 'utf8');
    const todasLasCampanas = JSON.parse(fileData);

    const query = String(mensaje || '').toLowerCase();

    // 1. EVALUAR SI PREGUNTA POR UN CASO ESPECÍFICO
    const coincidenciaEspecifica = todasLasCampanas.find(c => {
      const tit = String(c.Title || c.TITULO_PIEZA || '').toLowerCase();
      return tit.length > 3 && query.includes(tit);
    });

    let promptSistema = '';

    const reglasMetales = `
REGLA METODOLÓGICA DE METALES:
- "Grand Prix", "Gold", "Silver", "Bronze": Ganadoras en el podio.
- "Shortlist": Pieza que pasó la primera ronda de juzgamiento pero no obtuvo metal.
- "NO GANO": SIGNIFICA RECHAZADA / ELIMINADA. La pieza no entró ni siquiera al Shortlist en esa categoría específica. NO digas que quedó en shortlist si tiene "(NO GANO)".
`;

    if (coincidenciaEspecifica) {
      // MODO AUTOPSIA INDIVIDUAL (Board Completo)
      const c = coincidenciaEspecifica;
      promptSistema = `
Eres un jurado implacable y analista senior de festivales como Cannes Lions.
Tienes sobre la mesa la ficha oficial y completa del caso consultado:

DATOS OFICIALES DEL CASO (BÁSATE 100% EN ESTO, PROHIBIDO INVENTAR):
- Título: ${c.Title || c.TITULO_PIEZA}
- Marca: ${c.MARCA}
- Festival y Año: ${c.FESTIVAL || 'CANNES'} ${c.AÑO || c.ANIO || ''}
- Categorías: ${c.CATEGORIA_SUMMARY || c.CATEGORIA || 'No especificada'}
- Desglose de Metales: ${c.METAL_SUMMARY || c.METAL || 'NO GANO'}
- Agencia: ${c.AGENCIA || 'No especificada'}
- ANÁLISIS DE BOARD COMPLETO:
${c['ANALISIS BOARD'] || 'Sin información detallada de board.'}

${reglasMetales}

INSTRUCCIONES DE RESPUESTA:
1. Sé fiel a la idea real descrita en el board (no inventes ejecuciones inexistentes).
2. Estructura el análisis:
   - **Tensión & Insight real**: ¿Qué fricción cultural o de negocio atacó?
   - **Mecánica & Ejecución**: ¿Cómo operó la idea en el mundo real?
   - **Desempeño en Jurado**: Qué categorías ganó y en cuáles fue descartada (NO GANO). Explica por qué el jurado la castigó o la premió según el tipo de categoría.
   - **Pregunta Estratégica**: Para retar un brief en el presente.
`;

    } else {
      // MODO BENCHMARK / COMPARATIVO (Scoring en memoria)
      const aniosDetectados = query.match(/\b(20\d{2})\b/g) || [];
      const festivales = ['cannes', 'el ojo', 'clio', 'd&ad', 'eurobest'].filter(f => query.includes(f));
      const categorias = ['outdoor', 'film', 'direct', 'print', 'pr', 'purpose', 'brand purpose', 'activation', 'media', 'data'].filter(c => query.includes(c));

      const palabrasIgnoradas = new Set(['para', 'como', 'este', 'esta', 'campañas', 'versus', 'piezas', 'ganaron', 'hacer', 'unas', 'unos', 'sobre', 'entre']);
      const keywords = query
        .replace(/[^\wáéíóúñ\s]/gi, '')
        .split(/\s+/)
        .filter(w => w.length > 3 && !palabrasIgnoradas.has(w));

      const calificadas = todasLasCampanas.map(c => {
        let score = 0;
        const metales = String(c.METAL_SUMMARY || c.METAL || '').toLowerCase();
        const titulo = String(c.Title || c.TITULO_PIEZA || '').toLowerCase();
        const marca = String(c.MARCA || '').toLowerCase();
        const cat = String(c.CATEGORIA_SUMMARY || c.CATEGORIA || '').toLowerCase();
        const fest = String(c.FESTIVAL || '').toLowerCase();
        const anio = String(c.AÑO || c.ANIO || '');
        const board = String(c['ANALISIS BOARD'] || '').toLowerCase();

        if (metales.includes('grand prix')) score += 30;
        else if (metales.includes('gold')) score += 18;
        else if (metales.includes('silver')) score += 8;

        if (aniosDetectados.length > 0 && aniosDetectados.includes(anio)) score += 35;
        festivales.forEach(f => { if (fest.includes(f)) score += 20; });
        categorias.forEach(catItem => { if (cat.includes(catItem)) score += 25; });
        keywords.forEach(kw => {
          if (titulo.includes(kw)) score += 25;
          if (marca.includes(kw)) score += 20;
          if (board.includes(kw)) score += 10;
        });

        return { ...c, _score: score };
      });

      calificadas.sort((a, b) => b._score - a._score);
      const seleccionadas = calificadas.slice(0, 25);

      const baseSintetizada = seleccionadas.map((c, i) => {
        const titulo = String(c.Title || c.TITULO_PIEZA || 'S/T');
        const marca = String(c.MARCA || 'S/M');
        const fest = `${String(c.FESTIVAL || 'CANNES')} ${String(c.AÑO || c.ANIO || '')}`.trim();
        const metales = String(c.METAL_SUMMARY || c.METAL || 'NO GANO');
        let board = String(c['ANALISIS BOARD'] || '').replace(/\s+/g, ' ').trim();
        if (board.length > 250) board = board.substring(0, 250) + '...';

        return `${i + 1}. "${titulo}" (${marca} - ${fest}) | RESULTADOS: ${metales} | BOARD: ${board}`;
      }).join('\n\n');

      promptSistema = `
Eres un jurado estricto de Cannes Lions.
Tienes sobre la mesa estos casos reales de nuestra base de datos:

${baseSintetizada}

${reglasMetales}

PAUTAS DE RESPUESTA:
1. Responde de forma directa, analítica y sin rodeos.
2. Si te piden un versus:
   - Contrasta ganadoras (Grand Prix / Gold) frente a piezas que quedaron en Shortlist o que NO GANARON (eliminadas).
   - Genera una **Tabla Markdown** limpia (Columnas: Caso & Marca | Estatus Real | Tensión del Board | Brecha Estratégica).
   - Agrega 2 o 3 aprendizajes de fondo sobre qué diferenció la victoria del descarte.
   - Cierra con una pregunta estratégica para desafiar briefs creativos.
`;
    }

    let respuestaTexto = null;
    const esOpenRouter = apiKey.startsWith('sk-or-') || headerProvider === 'openrouter';

    if (esOpenRouter) {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://festival-ai.vercel.app',
          'X-Title': 'Festival AI'
        },
        body: JSON.stringify({
          model: 'minimax/minimax-m3:free',
          messages: [
            { role: 'system', content: promptSistema },
            { role: 'user', content: mensaje }
          ],
          temperature: 0.1,
          max_tokens: 2200
        })
      });

      const data = await resp.json();
      if (!resp.ok) {
        return res.status(500).json({ error: `Error OpenRouter: ${data.error?.message || resp.statusText}` });
      }
      respuestaTexto = data.choices?.[0]?.message?.content;

    } else {
      // Google Gemini (soporta claves AIzaSy y AQ)
      const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const resp = await fetch(urlGemini, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${promptSistema}\n\nConsulta: ${mensaje}` }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2200 }
        })
      });

      const data = await resp.json();
      if (!resp.ok) {
        // Fallback a gemini-3.6-flash si la cuenta exige 3.6
        if (data.error?.message && data.error.message.includes('gemini-3.6-flash')) {
          const url36 = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
          const resp36 = await fetch(url36, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: `${promptSistema}\n\nConsulta: ${mensaje}` }] }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 2200 }
            })
          });
          const data36 = await resp36.json();
          if (!resp36.ok) return res.status(500).json({ error: `Error Gemini: ${data36.error?.message}` });
          respuestaTexto = data36.candidates?.[0]?.content?.parts?.[0]?.text;
        } else {
          return res.status(500).json({ error: `Error Gemini: ${data.error?.message || resp.statusText}` });
        }
      } else {
        respuestaTexto = data.candidates?.[0]?.content?.parts?.[0]?.text;
      }
    }

    if (!respuestaTexto) {
      return res.status(500).json({ error: 'El modelo devolvió una respuesta vacía. Intenta reformular la consulta.' });
    }

    return res.status(200).json({ respuesta: respuestaTexto });

  } catch (error) {
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
