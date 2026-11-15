import {talentUIRegistry} from './TalentUIRegistry';
import {RenderHtmlTalentUI} from './RenderHtmlTalentUI';
import {WebSearchTalentUI} from './WebSearchTalentUI';
import {ImageTalentUI} from './ImageTalentUI';
import {ModelAnswerTalentUI} from './ModelAnswerTalentUI';

let registered = false;

// Separate from registerDefaultTalents so the talent UI (which pulls the
// bottom-sheet tree) is never in the module graph of engine-logic consumers.
export function registerDefaultTalentUIs(): void {
  if (registered) {
    return;
  }
  talentUIRegistry.register(new RenderHtmlTalentUI());
  talentUIRegistry.register(new WebSearchTalentUI());
  talentUIRegistry.register(new ImageTalentUI());
  talentUIRegistry.register(new ModelAnswerTalentUI());
  registered = true;
}

export function resetRegisteredTalentUIsFlag(): void {
  registered = false;
}
