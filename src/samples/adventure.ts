import { MACRO_VERSION, type Expr, type Macro, type Stmt } from "../macro/types";

/**
 * Every game tool answers `{ success, message, data? }` and reports a refused
 * action (locked door, wrong item, wrong room) as `success: false` instead of
 * throwing, so each step checks the flag and fails with the game's own reason.
 */
function step(tool: string, args: Record<string, string>): Stmt[] {
  const argExprs: Record<string, Expr> = {};
  for (const [key, value] of Object.entries(args)) argExprs[key] = { lit: value };
  return [
    { op: "call", tool, args: argExprs, saveAs: "result" },
    {
      op: "if",
      cond: { not: { get: { var: "result" }, path: ["success"] } },
      then: [{ op: "fail", message: { get: { var: "result" }, path: ["message"] } }],
    },
  ];
}

/** `walk_to` only crosses one door at a time, so routes list every room on the way. */
const walkTo = (...rooms: string[]): Stmt[] => rooms.flatMap((room) => step("walk", { target: room }));

/**
 * Plays WebMCP Adventure from a fresh start to the win (spec §12, macro 3):
 * get the storage PIN, power the Navigator, calibrate the thrusters and
 * replace the hyperdrive fuse.
 *
 * The game registers all of its tools once, after its renderer has loaded,
 * and never unregisters them, so any of them can serve as the trigger and
 * every call simply waits for its tool on a page that is still loading. The
 * NPC replies are fixed keyword matches, not a language model, so the
 * messages below are chosen to contain the keywords each NPC reacts to.
 */
export const adventureMacro: Macro = {
  wmm: MACRO_VERSION,
  id: "sample-adventure",
  name: "Finish WebMCP Adventure",
  description: "Walks the robot through every puzzle, from the Janitor's Closet to an active hyperdrive.",
  sites: {
    game: {
      match: ["https://bandarra.me/apps/webmcp-adventure/*"],
      startUrl: "https://bandarra.me/apps/webmcp-adventure/",
    },
  },
  tools: {
    look: { site: "game", name: "look_at" },
    walk: { site: "game", name: "walk_to" },
    talk: { site: "game", name: "talk_to" },
    pickUp: { site: "game", name: "pick_up" },
    use: { site: "game", name: "use" },
  },
  trigger: { site: "game", anyOf: [["walk", "talk", "use"]] },
  program: [
    // The route below starts in the Janitor's Closet; a game in progress is
    // somewhere else with items already taken, so ask for a fresh one.
    { op: "call", tool: "look", args: { target: { lit: "room" } }, saveAs: "here" },
    {
      op: "if",
      cond: {
        bin: "!=",
        left: { get: { var: "here" }, path: ["data", "room", "id"] },
        right: { lit: "janitor_closet" },
      },
      then: [{ op: "fail", message: { lit: "Restart the game first: the walkthrough starts in the Janitor's Closet." } }],
    },

    // Storage PIN: the Comms Agent reads it from the mission logs.
    ...walkTo("corridor", "comms_room"),
    ...step("talk", { target: "comms_agent", message: "What is the storage room PIN?" }),
    { op: "message", text: { get: { var: "result" }, path: ["message"] } },
    ...walkTo("corridor"),
    // The PIN is fixed in the game; the keypad's answer confirms it.
    ...step("use", { target: "storage_keypad", item: "4271" }),
    ...walkTo("storage_room"),
    ...step("pickUp", { target: "battery" }),
    ...step("pickUp", { target: "new_fuse" }),

    // Course: a powered Navigator plots it at once.
    ...walkTo("corridor", "bridge"),
    ...step("use", { target: "navigator", item: "battery" }),
    { op: "message", text: { lit: "Course plotted." } },

    // The Mechanical Agent hands over the fuse tool and the thruster values.
    ...walkTo("corridor", "mechanical_room"),
    ...step("talk", { target: "mechanical_agent", message: "I need the fuse installer tool for the hyperdrive." }),
    ...step("talk", { target: "mechanical_agent", message: "How do I calibrate the thrusters?" }),

    // Orientation: the calibration panel applies the agent's values.
    ...walkTo("corridor", "engineering_room"),
    ...step("use", { target: "thruster_console" }),
    { op: "message", text: { lit: "Ship oriented." } },

    // Hyperdrive: the tool first pulls the blown fuse, then seats the new one.
    ...walkTo("hyperdrive_room"),
    ...step("use", { target: "hyperdrive_unit", item: "fuse_tool" }),
    ...step("use", { target: "hyperdrive_unit", item: "fuse_tool" }),
    ...step("use", { target: "hyperdrive_unit" }),
    { op: "message", text: { lit: "Hyperdrive active. The ship is back on course." } },
  ],
};
