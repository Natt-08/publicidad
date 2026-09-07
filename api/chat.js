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

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Falta configurar OPENROUTER_API_KEY en Vercel.' });
  }

  try {
    const filePath = join(process.cwd(), 'campanas.json');
    const fileData = readFileSync(filePath, 'utf8');
    const todasLasCampanas = JSON.parse(fileData);

    // Mapeo exacto basado en las claves reales de tu JSON
    const baseSintetizada = todasLasCampanas.map((c, i) => {
      const titulo = c.Title || c.TITULO_PIEZA || c.titulo || 'Sin título';
      const marca = c.MARCA || c.marca || 'Sin marca';
      const festival = c.FESTIVAL || 'CANNES';
      const anio = c.AÑO || c.ANIO || c.anio || '';
      const categorias = c.CATEGORIA_SUMMARY || c.CATEGORIA || '';
      const metales = c.METAL_SUMMARY || c.METAL || 'NO GANO';
      const analisis = (c['ANALISIS BOARD'] || c.insight_problema || '').replace(/\s+/g, ' ').trim();
      const boardImg = c['Board image'] || '';

      // Determinar si tiene Grand Prix, Oro, Plata, Bronce o Shortlist
      let maxMetal = 'SHORTLIST / NO GANO';
      if (/grand prix/i.test(metales)) maxMetal = 'GRAND PRIX';
      else if (/gold/i.test(metales)) maxMetal = 'GOLD';
      else if (/silver/i.test(metales)) maxMetal = 'SILVER';
      else if (/bronze/i.test(metales)) maxMetal = 'BRONZE';

      return `${i + 1}. [${maxMetal}] "${titulo}" (${marca} - ${festival} ${anio}) | CAT: ${categorias} | METALES: ${metales} | ANÁLISIS: ${analisis}${boardImg ? ` | BOARD: ${boardImg}` : ''}`;
    }).join('\n');

    const promptSistema = `
Eres un analista estratégico y jurado implacable de Cannes Lions.
Tienes sobre la mesa un archivo de campañas reales con su información técnica, categorías, metales obtenidos y el desglose de su board de presentación:

=== REGISTRO DE CAMPAÑAS ===
${baseSintetizada}
============================

INSTRUCCIONES DE RESPUESTA:
1. Responde de forma directa, analítica y sin roleplay teatral.
2. Sí tienes piezas con [GRAND PRIX] (como "CONTRACT FOR CHANGE" de ABInBev o "ACT FOR FOOD" de Carrefour) y piezas de shortlist/no ganadoras (como "BALLER DECORATOR" de City of Chicago).
3. Si te piden un versus de categoría (ej. Outdoor, Film, Brand Purpose, etc.):
   - Filtra los casos reales de la base que compitieron o encajan en esa disciplina.
   - Contrasta qué separó al metal mayor (Grand Prix / Gold) de las no ganadoras: compara la fricción real, la transformación operativa/cultural vs la simple representación cosmética.
   - Utiliza tablas comparativas en Markdown para sintetizar los contrastes y cita los nombres y marcas exactos.
4. Concluye con una pregunta estratégica sobre el reto creativo que se esté resolviendo.
`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://vercel.com",
        "X-Title": "Festival AI"
      },
      body: JSON.stringify({
        model: "minimax/minimax-m3:free",
        messages: [
          { role: "system", content: promptSistema },
          { role: "user", content: mensaje }
        ],
        temperature: 0.3,
        max_tokens: 2800
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const err = data.error?.message || response.statusText;
      return res.status(500).json({ error: `Error de OpenRouter: ${err}` });
    }

    const choice = data.choices?.[0]?.message;
    const respuestaTexto = choice?.content || (typeof choice?.reasoning === 'string' ? choice.reasoning : null);

    if (!respuestaTexto) {
      return res.status(500).json({ error: 'Respuesta vacía del proveedor. Por favor reintenta.' });
    }

    return res.status(200).json({ respuesta: respuestaTexto });

  } catch (error) {
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
