// Translation files by the code getLanguage() returns. English lives in ../en.ts.
// The list: languages with a finished app translation and a website or help translation,
// per https://github.com/obsidianmd/obsidian-translations#existing-languages
import ar from "./ar.json";
import bn from "./bn.json";
import ca from "./ca.json";
import cs from "./cs.json";
import da from "./da.json";
import de from "./de.json";
import el from "./el.json";
import es from "./es.json";
import fa from "./fa.json";
import fi from "./fi.json";
import fr from "./fr.json";
import he from "./he.json";
import hu from "./hu.json";
import id from "./id.json";
import it from "./it.json";
import ja from "./ja.json";
import ko from "./ko.json";
import nl from "./nl.json";
import nb from "./no.json";
import pl from "./pl.json";
import pt from "./pt.json";
import ptBR from "./pt-BR.json";
import ro from "./ro.json";
import ru from "./ru.json";
import sk from "./sk.json";
import sv from "./sv.json";
import th from "./th.json";
import tr from "./tr.json";
import uk from "./uk.json";
import vi from "./vi.json";
import zh from "./zh.json";
import zhTW from "./zh-TW.json";

export const LOCALES: Record<string, string> = {
  ar,
  bn,
  ca,
  cs,
  da,
  de,
  el,
  es,
  fa,
  fi,
  fr,
  he,
  hu,
  id,
  it,
  ja,
  ko,
  nl,
  no: nb,
  pl,
  pt,
  "pt-BR": ptBR,
  ro,
  ru,
  sk,
  sv,
  th,
  tr,
  uk,
  vi,
  zh,
  "zh-TW": zhTW,
};
