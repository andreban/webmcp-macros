// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { MACRO_VERSION, type BinaryOp, type Expr, type Json, type Macro, type Stmt } from "../macro/types";

const lit = (value: Json): Expr => ({ lit: value });
const v = (name: string): Expr => ({ var: name });
const get = (from: Expr, ...path: string[]): Expr => ({ get: from, path });
const at = (dict: Expr, key: Expr): Expr => ({ getKey: dict, key });
const bin = (op: BinaryOp, left: Expr, right: Expr): Expr => ({ bin: op, left, right });
const and = (...all: Expr[]): Expr => all.reduce((left, right) => bin("and", left, right));
const isNull = (e: Expr): Expr => bin("==", e, lit(null));
const notNull = (e: Expr): Expr => bin("!=", e, lit(null));
const size = (e: Expr): Expr => ({ length: e });
const proc = (name: string, args: Record<string, Expr>): Expr => ({ callProc: name, args });
const set = (name: string, value: Expr): Stmt => ({ op: "set", var: name, value });
const setKey = (name: string, key: Expr, value: Expr): Stmt => ({ op: "setKey", var: name, key, value });
const when = (cond: Expr, then: Stmt[], otherwise?: Stmt[]): Stmt =>
  otherwise ? { op: "if", cond, then, else: otherwise } : { op: "if", cond, then };
const each = (list: Expr, name: string, body: Stmt[]): Stmt => ({ op: "forEach", list, var: name, body });
const ret = (value: Expr): Stmt => ({ op: "return", value });

const OPPOSITE = lit({ north: "south", south: "north", east: "west", west: "east" });
const ROW_STEP = lit({ north: -1, south: 1, east: 0, west: 0 });
const COL_STEP = lit({ north: 0, south: 0, east: 1, west: -1 });
/** Which blocker each item clears: keys open the door of their colour, dynamite blasts rock. */
const CLEARS = lit({ key_red: "door_red", key_blue: "door_blue", key_green: "door_green", dynamite: "rock" });

/** Cells are named "row,col" so they can key the map dictionaries. */
const cellOf = (position: Expr, dir?: Expr): Expr => {
  const row = get(position, "row");
  const col = get(position, "col");
  return bin(
    "+",
    dir ? bin("+", row, at(ROW_STEP, dir)) : row,
    bin("+", lit(","), dir ? bin("+", col, at(COL_STEP, dir)) : col),
  );
};

/** Calls an item tool and fails with the game's reason when it refuses. */
const act = (tool: string, args?: Record<string, Expr>): Stmt[] => [
  args ? { op: "call", tool, args, saveAs: "result" } : { op: "call", tool, saveAs: "result" },
  when({ not: get(v("result"), "success") }, [{ op: "fail", message: get(v("result"), "reason") }]),
];

/** Runs the statements of the first case whose condition holds, as an if/else-if chain. */
const firstOf = (cases: [Expr, Stmt[]][], otherwise: Stmt[]): Stmt[] =>
  cases.reduceRight<Stmt[]>((rest, [cond, then]) => [when(cond, then, rest)], otherwise);

/** Walks a planned route and returns the trail extended with the way back. */
const walkTo = (cell: Expr): Stmt =>
  set("trail", proc("walk", { path: proc("route", { map: v("map"), from: v("here"), to: cell }), trail: v("trail") }));

/**
 * Finishes the WebMCP Maze (spec §12, macro 4). The maze is hidden under fog,
 * so the macro maps it as it goes: `map` holds the open passages seen from
 * each visited cell, `items` the collectibles seen lying around, `blockers`
 * the doors and rocks seen, and `trail` the way back for depth-first search.
 *
 * The generator carves a perfect maze (a tree), so a depth-first walk crosses
 * each passage at most twice, which keeps a 10x10 maze inside the step
 * limit. Breadth-first planning is only used to fetch an item and carry it
 * to its blocker. The player holds one item at a time, so a useless one is
 * dropped on a free cell when nothing else is left to explore.
 *
 * `start_game` exists only before and after a game, and `look` and `move`
 * only during one, so the macro starts a game when it can and otherwise
 * continues the one in progress.
 */
export const mazeMacro: Macro = {
  wmm: MACRO_VERSION,
  id: "sample-maze",
  name: "Finish the WebMCP Maze",
  description: "Explores the fogged maze, clears doors and rocks with the items it finds, and walks out of the exit.",
  sites: {
    maze: {
      match: ["https://googlechromelabs.github.io/webmcp-tools/demos/webmcp-maze/*"],
      startUrl: "https://googlechromelabs.github.io/webmcp-tools/demos/webmcp-maze/",
    },
  },
  tools: {
    start: { site: "maze", name: "start_game" },
    look: { site: "maze", name: "look" },
    move: { site: "maze", name: "move" },
    pickup: { site: "maze", name: "pickup" },
    drop: { site: "maze", name: "drop" },
    use: { site: "maze", name: "use" },
  },
  trigger: { site: "maze", anyOf: [["start"], ["look", "move"]] },
  procedures: {
    // Returns the directions from `from` to `to` last step first, ready for popBack.
    route: {
      params: ["map", "from", "to"],
      body: [
        set("queue", { list: [v("from")] }),
        set("prev", { obj: {} }),
        setKey("prev", v("from"), lit("start")),
        {
          op: "while",
          cond: and(bin(">", size(v("queue")), lit(0)), { not: { hasKey: v("prev"), key: v("to") } }),
          body: [
            { op: "popFront", var: "queue", saveAs: "cell" },
            set("exits", at(v("map"), v("cell"))),
            when(notNull(v("exits")), [
              each({ keys: v("exits") }, "dir", [
                set("next", at(v("exits"), v("dir"))),
                when({ not: { hasKey: v("prev"), key: v("next") } }, [
                  setKey("prev", v("next"), { obj: { cell: v("cell"), dir: v("dir") } }),
                  { op: "push", var: "queue", value: v("next") },
                ]),
              ]),
            ]),
          ],
        },
        when({ not: { hasKey: v("prev"), key: v("to") } }, [{ op: "fail", message: bin("+", lit("No known way to "), v("to")) }]),
        set("path", { list: [] }),
        set("cell", v("to")),
        {
          op: "while",
          cond: bin("!=", v("cell"), v("from")),
          body: [
            set("link", at(v("prev"), v("cell"))),
            { op: "push", var: "path", value: get(v("link"), "dir") },
            set("cell", get(v("link"), "cell")),
          ],
        },
        ret(v("path")),
      ],
    },
    walk: {
      params: ["path", "trail"],
      body: [
        {
          op: "while",
          cond: bin(">", size(v("path")), lit(0)),
          body: [
            { op: "popBack", var: "path", saveAs: "dir" },
            ...act("move", { direction: v("dir") }),
            // Stepping back along the trail shortens it, so in a tree the
            // trail stays the one path back instead of growing with detours.
            when(
              bin("==", at(v("trail"), bin("-", size(v("trail")), lit(1))), v("dir")),
              [{ op: "popBack", var: "trail" }],
              [{ op: "push", var: "trail", value: at(OPPOSITE, v("dir")) }],
            ),
          ],
        },
        ret(v("trail")),
      ],
    },
    // A seen blocker that `item` clears, as { cell, dir, type }, or null.
    blockerFor: {
      params: ["blockers", "item"],
      body: [
        each({ keys: v("blockers") }, "key", [
          set("blocker", at(v("blockers"), v("key"))),
          when(bin("==", get(v("blocker"), "type"), at(CLEARS, v("item"))), [ret(v("blocker"))]),
        ]),
        ret(lit(null)),
      ],
    },
    // A visited cell with no item on it, where the held item can be dropped.
    emptyCell: {
      params: ["map", "items"],
      body: [
        each({ keys: v("map") }, "cell", [when(isNull(at(v("items"), v("cell"))), [ret(v("cell"))])]),
        { op: "fail", message: lit("Found no free cell to drop an item on.") },
      ],
    },
    // The first value that is not null, or null.
    firstValue: {
      params: ["dict"],
      body: [
        each({ keys: v("dict") }, "key", [when(notNull(at(v("dict"), v("key"))), [ret(at(v("dict"), v("key")))])]),
        ret(lit(null)),
      ],
    },
    // The cell of a seen item that clears a seen blocker, or null.
    usefulItem: {
      params: ["items", "blockers"],
      body: [
        each({ keys: v("items") }, "cell", [
          set("item", at(v("items"), v("cell"))),
          when(and(notNull(v("item")), notNull(proc("blockerFor", { blockers: v("blockers"), item: v("item") }))), [
            ret(v("cell")),
          ]),
        ]),
        ret(lit(null)),
      ],
    },
  },
  program: [
    when({ toolAvailable: "start" }, [{ op: "call", tool: "start" }]),
    ...["map", "frontier", "items", "blockers"].map((name) => set(name, { obj: {} })),
    set("trail", { list: [] }),
    ...["dropped", "carried", "goal"].map((name) => set(name, lit(null))),
    // Cells seen but not visited yet; at zero there is no point backtracking.
    set("pending", lit(0)),
    set("moved", lit({ atExit: false })),
    {
      op: "while",
      cond: { not: get(v("moved"), "atExit") },
      body: [
        { op: "call", tool: "look", saveAs: "view" },
        set("here", cellOf(get(v("view"), "position"))),
        set("held", get(v("view"), "inventory")),
        set("found", get(v("view"), "collectibleHere")),
        set("blocked", get(v("view"), "blockedDirections")),
        // Record the passages from here and pick an unvisited neighbour,
        // preferring south and east since the exit is the bottom-right corner.
        set("exits", { obj: {} }),
        set("next", lit(null)),
        each(get(v("view"), "openDirections"), "dir", [
          set("cell", cellOf(get(v("view"), "position"), v("dir"))),
          setKey("exits", v("dir"), v("cell")),
          when({ not: { hasKey: v("map"), key: v("cell") } }, [
            when(isNull(at(v("frontier"), v("cell"))), [set("pending", bin("+", v("pending"), lit(1)))]),
            setKey("frontier", v("cell"), v("here")),
            when(bin("or", isNull(v("next")), { contains: lit(["south", "east"]), item: v("dir") }), [set("next", v("dir"))]),
          ]),
        ]),
        setKey("map", v("here"), v("exits")),
        when(notNull(at(v("frontier"), v("here"))), [set("pending", bin("-", v("pending"), lit(1)))]),
        setKey("frontier", v("here"), lit(null)),
        when(v("blocked"), [
          each({ keys: v("blocked") }, "dir", [
            setKey("blockers", bin("+", v("here"), v("dir")), { obj: { cell: v("here"), dir: v("dir"), type: at(v("blocked"), v("dir")) } }),
          ]),
        ]),
        when(notNull(v("found")), [setKey("items", v("here"), v("found"))]),
        // Look for a blocker the held item clears only when either side changed.
        when(
          isNull(v("held")),
          [set("goal", lit(null))],
          [
            when(bin("or", bin("!=", v("held"), v("carried")), v("blocked")), [
              set("goal", proc("blockerFor", { blockers: v("blockers"), item: v("held") })),
            ]),
          ],
        ),
        set("carried", v("held")),
        set("unexplored", lit(null)),
        when(and(isNull(v("next")), bin(">", v("pending"), lit(0)), bin("==", size(v("trail")), lit(0))), [
          set("unexplored", proc("firstValue", { dict: v("frontier") })),
        ]),
        ...firstOf(
          [
            // Take what lies here, unless it was put down to free the hands.
            [
              and(isNull(v("held")), notNull(v("found")), bin("!=", v("here"), v("dropped"))),
              [...act("pickup"), setKey("items", v("here"), lit(null))],
            ],
            // Clear a seen blocker with the held item, or go to it.
            [
              bin("==", get(v("goal"), "cell"), v("here")),
              [...act("use", { direction: get(v("goal"), "dir") }), setKey("blockers", bin("+", v("here"), get(v("goal"), "dir")), lit(null))],
            ],
            [notNull(v("goal")), [walkTo(get(v("goal"), "cell"))]],
            // Explore depth first, backtracking along the trail.
            [
              notNull(v("next")),
              [...act("move", { direction: v("next") }), set("moved", v("result")), { op: "push", var: "trail", value: at(OPPOSITE, v("next")) }],
            ],
            [
              and(bin(">", v("pending"), lit(0)), bin(">", size(v("trail")), lit(0))),
              [{ op: "popBack", var: "trail", saveAs: "back" }, ...act("move", { direction: v("back") })],
            ],
            // Return to a cell next to a passage left unexplored after a detour.
            [notNull(v("unexplored")), [walkTo(v("unexplored"))]],
            // Everything reachable is explored: put down a useless item...
            [
              notNull(v("held")),
              [
                set("spot", v("here")),
                when(notNull(v("found")), [set("spot", proc("emptyCell", { map: v("map"), items: v("items") }))]),
                walkTo(v("spot")),
                ...act("drop"),
                setKey("items", v("spot"), v("held")),
                set("dropped", v("spot")),
              ],
            ],
          ],
          // ...or fetch one that clears a seen blocker.
          [
            set("target", proc("usefulItem", { items: v("items"), blockers: v("blockers") })),
            when(isNull(v("target")), [{ op: "fail", message: lit("Found no way to the exit.") }]),
            walkTo(v("target")),
            ...act("pickup"),
            setKey("items", v("target"), lit(null)),
            set("dropped", lit(null)),
          ],
        ),
      ],
    },
    { op: "message", text: bin("+", lit("Out of the maze in "), bin("+", get(v("moved"), "moveCount"), lit(" moves."))) },
  ],
};
