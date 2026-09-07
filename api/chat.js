import { readFileSync } from 'fs';
import { join } from 'path';

export const config = {
  maxDuration: 15
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
  const apiKey = userKey || process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ 
      error: 'Falta configurar tu API Key en Vercel o en la interfaz.' 
    });
  }

  try {
    const filePath = join(process.cwd(), 'campanas.json');
    const fileData = readFileSync(filePath, 'utf8');
    const todasLasCampanas = JSON.parse(fileData);

    const query = String(mensaje || '').toLowerCase();

    // Detección ágil de filtros
    const aniosDetectados = query.match(/\b(20\d{2})\b/g) || [];
    const festivales = ['cannes', 'el ojo', 'clio', 'd&ad', 'eurobest'].filter(f => query.includes(f));
    const categorias = ['outdoor', 'film', 'direct', 'print', 'pr', 'purpose', 'brand purpose', 'activation', 'media'].filter(c => query.includes(c));

    const palabrasIgnoradas = new Set(['para', 'como', 'este', 'esta', 'campañas', 'versus', 'piezas', 'ganaron', 'hacer', 'unas', 'unos', 'sobre', 'entre']);
    const keywords = query
      .replace(/[^\wáéíóúñ\s]/gi, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !palabrasIgnoradas.has(w));

    // Scoring
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

      if (aniosDetectados.length > 0) {
        if (aniosDetectados.includes(anio)) score += 35;
        else score -= 15;
      }

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
    // Reducimos a 20 casos clave para garantizar respuesta en 3 segundos
    const seleccionadas = calificadas.slice(0, 20);

    const baseSintetizada = seleccionadas.map((c, i) => {
      const titulo = String(c.Title || c.TITULO_PIEZA || 'S/T');
      const marca = String(c.MARCA || 'S/M');
      const fest = `${String(c.FESTIVAL || 'CANNES')} ${String(c.AÑO || c.ANIO || '')}`.trim();
      const cat = String(c.CATEGORIA_SUMMARY || c.CATEGORIA || '');
      const metales = String(c.METAL_SUMMARY || c.METAL || 'NO GANO');
      
      let board = String(c['ANALISIS BOARD'] || '').replace(/\s+/g, ' ').trim();
      if (board.length > 150) board = board.substring(0, 150) + '...';

      let maxMetal = 'SHORTLIST';
      if (/grand prix/i.test(metales)) maxMetal = 'GRAND PRIX';
      else if (/gold/i.test(metales)) maxMetal = 'GOLD';
      else if (/silver/i.test(metales)) maxMetal = 'SILVER';

      return `${i + 1}. [${maxMetal}] "${titulo}" (${marca} - ${fest}) | CAT: ${cat} | METALES: ${metales} | BOARD: ${board}`;
    }).join('\n');

    const promptSistema = `
Eres un jurado estricto y analista estratégico de Cannes Lions.
Tienes sobre la mesa una muestra depurada de casos:

${baseSintetizada}

PAUTAS DE VELOCIDAD Y ESTRUCTURA:
1. Ve directo al grano sin introducciones ni saludos.
2. Si te piden un versus, selecciona exactamente entre 4 y 6 casos clave (ej. 3 Ganadoras vs 3 Shortlist).
3. Estructura la respuesta así:
   - **Tabla Markdown** comparativa (Columnas: Caso & Marca | Metal | Tensión / Insight | Brecha Estratégica).
   - **2 o 3 aprendizajes concisos** sobre por qué las ganadoras triunfaron frente al conformismo de las no ganadoras.
   - **Una pregunta estratégica** de cierre para el brief.
4. Máximo 400 palabras para garantizar respuesta rápida.
`;

    let respuestaTexto = null;
    const esOpenRouter = apiKey.startsWith('sk-or-');

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
          temperature: 0.2,
          max_tokens: 1200
        })
      });

      const data = await resp.json();
      if (!resp.ok) {
        return res.status(500).json({ error: data.error?.message || resp.statusText });
      }
      respuestaTexto = data.choices?.[0]?.message?.content;

    } else {
      // Endpoint Gemini Flash
      const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const resp = await fetch(urlGemini, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${promptSistema}\n\nConsulta: ${mensaje}` }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1200 }
        })
      });

      const data = await resp.json();
      if (!resp.ok) {
        return res.status(500).json({ error: data.error?.message || resp.statusText });
      }
      respuestaTexto = data.candidates?.[0]?.content?.parts?.[0]?.text;
    }

    if (!respuestaTexto) {
      return res.status(500).json({ error: 'Respuesta vacía del proveedor.' });
    }

    return res.status(200).json({ respuesta: respuestaTexto });

  } catch (error) {
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
