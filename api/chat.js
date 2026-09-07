import { readFileSync } from 'fs';
import { join } from 'path';

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { mensaje, historial = [] } = req.body || {};
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

    // Palabras reservadas del sistema que NO deben coincidir como nombres de campaña
    const palabrasIgnoradasTitulo = new Set([
      'base', 'campaña', 'campana', 'festival', 'cannes', 'eurobest', 'dubai', 'lynx',
      'ideas', 'piezas', 'casos', 'versus', 'detalle', 'analisis', 'tabla', 'todas', 'links', 'link'
    ]);

    // 1. DETECCIÓN DE CASO ESPECÍFICO
    const coincidenciaEspecifica = todasLasCampanas.find(c => {
      const tit = String(c.Title || c.TITULO_PIEZA || '').toLowerCase().trim();
      if (tit.length < 4 || palabrasIgnoradasTitulo.has(tit)) return false;
      return query.includes(tit);
    });

    let promptSistema = '';

    const reglasMetalesYLinks = `
REGLAS METODOLÓGICAS:
- "Grand Prix", "Gold", "Silver", "Bronze": Ganadoras en el podio.
- "Shortlist": Pieza que superó el primer corte del jurado pero no obtuvo metal.
- "NO GANO": SIGNIFICA RECHAZADA / ELIMINADA. La pieza no entró a Shortlist en esa categoría. Prohibido decir que quedó en shortlist si tiene "(NO GANO)".
- ENLACES Y RECURSOS: Cada caso incluye su enlace oficial ("LINK_BOARD"). Si el usuario solicita enlaces, links, imágenes o referencias visuales, ES OBLIGATORIO incluir el enlace correspondiente en formato Markdown: [Ver Board Oficial](URL). No digas que no tienes links si vienen provistos en los datos.
`;

    if (coincidenciaEspecifica) {
      // MODO CASO PUNTUAL (Board completo + Enlaces)
      const c = coincidenciaEspecifica;
      const linkBoard = c['Board image'] || c.URL || c.LINK || c.board_image || 'No disponible';
      
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
- LINK_BOARD: ${linkBoard}
- ANÁLISIS DE BOARD COMPLETO:
${c['ANALISIS BOARD'] || 'Sin información detallada de board.'}

${reglasMetalesYLinks}

INSTRUCCIONES:
1. No inventes ejecuciones que no figuren en este board.
2. Desglosa tensión, mecánica real y veredicto de jurado de forma directa.
3. Si el usuario pide el enlace o imagen del board, entrégalo explícitamente: [Ver Board Oficial](${linkBoard}).
`;

    } else {
      // MODO BENCHMARK Y BÚSQUEDA GENERAL
      const aniosDetectados = query.match(/\b(20\d{2})\b/g) || [];
      const festivales = ['cannes', 'el ojo', 'clio', 'd&ad', 'eurobest', 'dubai lynx'].filter(f => query.includes(f));
      const categorias = ['outdoor', 'film', 'direct', 'print', 'pr', 'purpose', 'brand purpose', 'activation', 'media', 'data', 'gaming', 'health'].filter(c => query.includes(c));

      const palabrasIgnoradas = new Set(['para', 'como', 'este', 'esta', 'campañas', 'versus', 'piezas', 'ganaron', 'hacer', 'unas', 'unos', 'sobre', 'entre', 'base', 'datos', 'links', 'dame']);
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

        if (query.includes('rechazadas') || query.includes('no ganaron') || query.includes('no gano')) {
          if (metales.includes('no gano') && !metales.includes('grand prix') && !metales.includes('gold')) {
            score += 40;
          }
        }

        if (aniosDetectados.length > 0 && aniosDetectados.includes(anio)) score += 35;
        festivales.forEach(f => { if (fest.includes(f)) score += 20; });
        categorias.forEach(catItem => { if (cat.includes(catItem)) score += 25; });
        
        keywords.forEach(kw => {
          if (titulo.includes(kw)) score += 30;
          if (marca.includes(kw)) score += 25;
          if (board.includes(kw)) score += 18;
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
        const linkBoard = c['Board image'] || c.URL || c.LINK || c.board_image || 'No disponible';
        
        let board = String(c['ANALISIS BOARD'] || '').replace(/\s+/g, ' ').trim();
        if (board.length > 250) board = board.substring(0, 250) + '...';

        return `${i + 1}. "${titulo}" (${marca} - ${fest}) | LINK_BOARD: ${linkBoard} | RESULTADOS: ${metales} | BOARD: ${board}`;
      }).join('\n\n');

      promptSistema = `
Eres un jurado estricto de Cannes Lions.
Tienes sobre la mesa esta selección de casos extraídos de la base de datos:

${baseSintetizada}

${reglasMetalesYLinks}

PAUTAS DE RESPUESTA:
1. Responde de forma analítica, directa y profesional.
2. Si te piden un versus, presenta la síntesis en una Tabla Markdown.
3. Si el usuario pide enlaces o links de los casos citados, facilítalos con su nombre en Markdown: [Ver Board Oficial](URL). Si el enlace dice 'No disponible', dilo transparentemente.
4. Si una campaña no figura en los datos, aclara que no está en el registro. Prohibido inventar URLs o casos.
`;
    }

    const mensajesParaLLM = [
      { role: 'system', content: promptSistema },
      ...historial.slice(-4),
      { role: 'user', content: mensaje }
    ];

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
          messages: mensajesParaLLM,
          temperature: 0.35,
          presence_penalty: 0.4,
          max_tokens: 2200
        })
      });

      const data = await resp.json();
      if (!resp.ok) return res.status(500).json({ error: `Error OpenRouter: ${data.error?.message || resp.statusText}` });
      respuestaTexto = data.choices?.[0]?.message?.content;

    } else {
      const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const payloadGemini = {
        contents: [
          { role: 'user', parts: [{ text: `${promptSistema}\n\nConsulta del usuario: ${mensaje}` }] }
        ],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2200 }
      };

      const resp = await fetch(urlGemini, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadGemini)
      });

      const data = await resp.json();
      if (!resp.ok) {
        if (data.error?.message && data.error.message.includes('gemini-3.6-flash')) {
          const url36 = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
          const resp36 = await fetch(url36, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadGemini)
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
      return res.status(500).json({ error: 'El proveedor devolvió una respuesta vacía.' });
    }

    return res.status(200).json({ respuesta: respuestaTexto });

  } catch (error) {
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
