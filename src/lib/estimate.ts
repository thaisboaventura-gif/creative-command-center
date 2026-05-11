export function estimateHours(
  summary: string,
  timeOriginal: number | null
): { hours: number; detail: string } {
  if (timeOriginal) {
    const h = Math.round((timeOriginal / 3600) * 10) / 10;
    return { hours: h, detail: `jira: ${h}h` };
  }

  const s = summary
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const qm = s.match(
    /(\d+)\s*(posts?|pecas?|criativos?|banners?|stories?|cards?|artes?|estaticos?|roteiros?|videos?|pieces?|anuncios?|motions?)/
  );
  const qty = qm ? parseInt(qm[1]) : 1;

  const dur = (str: string): number | null => {
    const m = str.match(/(\d+)\s*s(?:eg)?/);
    return m ? parseInt(m[1]) : null;
  };
  const secs = dur(s) || 30;
  const secRatio = secs / 30;

  if (s.includes("storyboard"))
    return { hours: qty * 4 * secRatio, detail: `${qty}x storyboard ${secs}s` };
  if (
    (s.includes("layout") || s.includes("design")) &&
    (s.includes("cartela") || s.includes("roteiro") || s.includes("video") || s.includes("motion"))
  )
    return { hours: qty * 4 * secRatio, detail: `${qty}x layout cartela ${secs}s` };
  if (
    (s.includes("layout") || s.includes("design") || s.includes("arte") || s.includes("estatico")) &&
    (s.includes("post") || s.includes("peca") || s.includes("card") || s.includes("story") || s.includes("anuncio"))
  )
    return { hours: qty * 2, detail: `${qty}x layout estatico` };
  if ((s.includes("banner") || s.includes("header")) && (s.includes("layout") || s.includes("design")))
    return { hours: qty * 1, detail: `${qty}x banner layout` };
  if ((s.includes("banner") || s.includes("header")) && (s.includes("copy") || s.includes("texto")))
    return { hours: qty * 0.5, detail: `${qty}x banner copy` };
  if (s.includes("banner") || s.includes("header") || s.includes("footer"))
    return { hours: qty * 1, detail: `${qty}x banner` };
  if (s.includes("motion") || s.includes("animac"))
    return { hours: qty * 4 * secRatio, detail: `${qty}x motion ${secs}s` };
  if (
    (s.includes("edicao") || s.includes("edicion") || s.includes("montagem") || s.includes("edic")) &&
    s.includes("video")
  )
    return { hours: qty * 4 * secRatio, detail: `${qty}x edicao video` };
  if (s.includes("edicao") || s.includes("edicion") || s.includes("montagem"))
    return { hours: qty * 4, detail: `${qty}x edicao` };
  if (s.includes("roteiro") || s.includes("script"))
    return { hours: qty * 2 * secRatio, detail: `${qty}x roteiro ${secs}s` };
  if (s.includes("copy") && (s.includes("lp") || s.includes("landing")))
    return { hours: qty * 2, detail: `${qty}x copy LP` };
  if (s.includes("copy") || s.includes("texto"))
    return { hours: qty * 0.75, detail: `${qty}x copy post` };
  if (
    s.includes("video") &&
    (s.includes("institucional") || s.includes("producao") || s.includes("campanha") || s.includes("ads"))
  )
    return { hours: 24, detail: "video producao" };
  if (s.includes("video"))
    return { hours: qty * 4 * secRatio, detail: `${qty}x video` };
  if (s.includes("landing") || s.match(/\blp\b/))
    return { hours: 2, detail: "LP" };
  if (s.includes("gravac") || s.includes("grabac") || s.includes("filmag"))
    return { hours: 4, detail: "gravacao" };
  if (s.includes("ppt") || s.includes("apresentac") || s.includes("deck"))
    return { hours: 3, detail: "apresentacao" };
  if (s.includes("template")) return { hours: 2, detail: "template" };
  if (s.includes("email") || s.includes("newsletter") || s.includes("mailing"))
    return { hours: 1.5, detail: "email" };
  if (s.includes("post") || s.includes("story") || s.includes("stories"))
    return { hours: qty * 0.75, detail: `${qty}x post` };
  if (s.includes("cartela")) return { hours: qty * 1, detail: `${qty}x cartela` };
  if (s.includes("gif")) return { hours: qty * 1, detail: `${qty}x gif` };

  return { hours: 2, detail: "geral" };
}
