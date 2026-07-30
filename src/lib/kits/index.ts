// src/lib/kits/index.ts
// Registers every playable character's kit. Importing this file (which
// nothing does yet — combat-loop dispatch is deferred to Kaelith's build)
// populates CHARACTER_KITS as a side effect.
import { CHARACTER_KITS } from "../characterKit";
import { solaceKit } from "./solaceKit";
import "./kaelithKit";
import "./vesperKit";

CHARACTER_KITS[solaceKit.id] = solaceKit;
