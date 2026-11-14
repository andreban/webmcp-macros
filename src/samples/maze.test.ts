// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { Json } from "../macro/types";
import { runMacro, type ToolHost } from "../runner/interpreter";
import { mazeMacro } from "./maze";

type Dir = "north" | "south" | "east" | "west";
const DIRS: readonly Dir[] = ["north", "south", "east", "west"];
const STEP: Record<Dir, [number, number]> = { north: [-1, 0], south: [1, 0], east: [0, 1], west: [0, -1] };
const OPPOSITE: Record<Dir, Dir> = { north: "south", south: "north", east: "west", west: "east" };
const CLEARS: Record<string, string> = { key_red: "door_red", key_blue: "door_blue", key_green: "door_green", dynamite: "rock" };

interface Layout {
  rows: number;
  cols: number;
  /** Passages as "row,col dir", e.g. "0,0 east". */
  passages: string[];
  /** Blockers by passage, as "row,col dir" to blocker type. */
  blockers?: Record<string, string>;
  /** Collectibles by "row,col". */
  items?: Record<string, string>;
}

const cellKey = (row: number, col: number) => `${row},${col}`;
const neighbour = (cell: string, dir: Dir): string => {
  const [row = 0, col = 0] = cell.split(",").map(Number);
  return cellKey(row + STEP[dir][0], col + STEP[dir][1]);
};

/**
 * A model of the WebMCP Maze (GoogleChromeLabs/webmcp-tools,
 * demos/webmcp-maze) with the rules the macro depends on: tools that swap
 * with the game state, fog of war over the exit, one item in hand, one item
 * per cell, and blockers that sit on both sides of a passage until the
 * matching item clears them.
 */
function fakeMaze(layout: Layout, playing = false) {
  const open = new Set<string>();
  const blockers = new Map<string, string>();
  for (const passage of layout.passages) {
    const [cell = "", dir] = passage.split(" ") as [string, Dir];
    open.add(`${cell} ${dir}`).add(`${neighbour(cell, dir)} ${OPPOSITE[dir]}`);
  }
  for (const [passage, type] of Object.entries(layout.blockers ?? {})) {
    const [cell = "", dir] = passage.split(" ") as [string, Dir];
    blockers.set(passage, type).set(`${neighbour(cell, dir)} ${OPPOSITE[dir]}`, type);
  }
  const items = new Map(Object.entries(layout.items ?? {}));
  const exit = cellKey(layout.rows - 1, layout.cols - 1);
  const state = { playing, won: false, at: "0,0", inventory: null as string | null, moves: 0 };
  const revealed = new Set<string>();
  const messages: string[] = [];

  const openDirections = () => DIRS.filter((d) => open.has(`${state.at} ${d}`) && !blockers.has(`${state.at} ${d}`));
  const reveal = () => [state.at, ...openDirections().map((d) => neighbour(state.at, d))].forEach((c) => revealed.add(c));
  const position = (cell: string) => {
    const [row = 0, col = 0] = cell.split(",").map(Number);
    return { row, col };
  };
  const direction = (args: Record<string, Json>): Dir => {
    const dir = DIRS.find((d) => d === args.direction);
    if (!dir) throw new Error(`bad direction ${String(args.direction)}`);
    return dir;
  };

  const gameplay: Record<string, (args: Record<string, Json>) => Json> = {
    look: (): Json => {
      const blocked = Object.fromEntries(DIRS.flatMap((d) => (open.has(`${state.at} ${d}`) && blockers.has(`${state.at} ${d}`) ? [[d, blockers.get(`${state.at} ${d}`) ?? ""]] : [])));
      return {
        position: position(state.at),
        openDirections: openDirections(),
        ...(Object.keys(blocked).length > 0 ? { blockedDirections: blocked } : {}),
        collectibleHere: items.get(state.at) ?? null,
        inventory: state.inventory,
        atExit: state.at === exit,
        exitPosition: revealed.has(exit) ? position(exit) : "unknown — not yet visible through fog of war",
        mazeSize: { rows: layout.rows, cols: layout.cols },
        moveCount: state.moves,
      };
    },
    move: (args): Json => {
      const dir = direction(args);
      if (!openDirections().includes(dir)) return { success: false, reason: `There is a wall blocking the ${dir} direction.` };
      state.at = neighbour(state.at, dir);
      state.moves++;
      reveal();
      if (state.at === exit) Object.assign(state, { playing: false, won: true });
      return { success: true, position: position(state.at), atExit: state.at === exit, moveCount: state.moves };
    },
    pickup: (): Json => {
      const item = items.get(state.at);
      if (!item) return { success: false, reason: "There is no item to pick up at your current location." };
      if (state.inventory) return { success: false, reason: "Your hands are full." };
      items.delete(state.at);
      state.inventory = item;
      return { success: true, item };
    },
    drop: (): Json => {
      if (!state.inventory) return { success: false, reason: "You are not carrying any item." };
      if (items.has(state.at)) return { success: false, reason: "There is already an item on this cell." };
      items.set(state.at, state.inventory);
      state.inventory = null;
      return { success: true };
    },
    use: (args): Json => {
      const dir = direction(args);
      const blocker = blockers.get(`${state.at} ${dir}`);
      if (!state.inventory) return { success: false, reason: "You are not holding any item to use." };
      if (!blocker) return { success: false, reason: `No blocker found in the ${dir} direction.` };
      if (CLEARS[state.inventory] !== blocker) return { success: false, reason: `Your item cannot clear the ${blocker}.` };
      blockers.delete(`${state.at} ${dir}`);
      blockers.delete(`${neighbour(state.at, dir)} ${OPPOSITE[dir]}`);
      state.inventory = null;
      reveal();
      return { success: true, direction: dir };
    },
  };
  const tools = (): Record<string, (args: Record<string, Json>) => Json> =>
    state.playing ? gameplay : { start_game: () => ((state.playing = true), reveal(), { message: "A new maze has been generated!" }) };

  const host: ToolHost = {
    async callTool(name, args) {
      const tool = tools()[name];
      if (!tool) throw new Error(`${name} is not registered now`);
      return tool(args);
    },
    isToolAvailable: async (name) => name in tools(),
    async waitForTool(name) {
      if (!(name in tools())) throw new Error(`Timed out waiting for ${name}.`);
    },
    message: (text) => messages.push(text),
  };
  return { host, state, messages };
}

/** A seeded random number generator, so a failing maze can be replayed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a maze the way the game does: a recursive backtracker, then
 * blockers on passages of the shortest start-to-exit path (never the first
 * or last), each with its item in a cell closer to the start than it.
 */
function generate(seed: number, rows = 10, cols = 10, blockerCount = 3): Layout {
  // Like the game, start over when an item finds no room before its blocker.
  for (let attempt = seed; ; attempt += 1000) {
    const layout = tryGenerate(attempt, rows, cols, blockerCount);
    if (layout) return layout;
  }
}

function tryGenerate(seed: number, rows: number, cols: number, blockerCount: number): Layout | null {
  const random = mulberry32(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const passages: string[] = [];
  const links = new Map<string, Map<Dir, string>>();
  const link = (from: string, dir: Dir) => {
    const to = neighbour(from, dir);
    passages.push(`${from} ${dir}`);
    links.set(from, (links.get(from) ?? new Map()).set(dir, to));
    links.set(to, (links.get(to) ?? new Map()).set(OPPOSITE[dir], from));
  };
  const inside = (cell: string) => {
    const { row, col } = { row: Number(cell.split(",")[0]), col: Number(cell.split(",")[1]) };
    return row >= 0 && row < rows && col >= 0 && col < cols;
  };
  const stack = ["0,0"];
  const visited = new Set(stack);
  while (stack.length > 0) {
    const current = stack.at(-1) ?? "";
    const options = DIRS.filter((d) => inside(neighbour(current, d)) && !visited.has(neighbour(current, d)));
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const dir = pick(options);
    link(current, dir);
    visited.add(neighbour(current, dir));
    stack.push(neighbour(current, dir));
  }

  const dist = new Map([["0,0", 0]]);
  const prev = new Map<string, [string, Dir]>();
  const queue = ["0,0"];
  for (let cell = queue.shift(); cell !== undefined; cell = queue.shift()) {
    for (const [dir, next] of links.get(cell) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, (dist.get(cell) ?? 0) + 1);
      prev.set(next, [cell, dir]);
      queue.push(next);
    }
  }
  const exit = cellKey(rows - 1, cols - 1);
  const path: [string, Dir][] = [];
  for (let step = prev.get(exit); step; step = prev.get(step[0])) path.unshift(step);
  const candidates = path.slice(1, -1).sort(() => random() - 0.5);
  const types = ["rock", pick(["door_red", "door_blue", "door_green"]), pick(Object.values(CLEARS))];
  const blockers: Record<string, string> = {};
  const items: Record<string, string> = {};
  let roomy = true;
  candidates.slice(0, blockerCount).forEach(([cell, dir], i) => {
    const type = types[i] ?? "rock";
    blockers[`${cell} ${dir}`] = type;
    const spots = [...dist].filter(([c, d]) => d > 0 && d < (dist.get(cell) ?? 0) && !(c in items)).map(([c]) => c);
    if (spots.length === 0) roomy = false;
    else items[pick(spots)] = Object.keys(CLEARS).find((item) => CLEARS[item] === type) ?? "dynamite";
  });
  return roomy ? { rows, cols, passages, blockers, items } : null;
}

/** 3x3, start top-left, exit bottom-right; the red key waits down a side branch. */
const oneKeyOneDoor: Layout = {
  rows: 3,
  cols: 3,
  passages: ["0,0 east", "0,1 east", "0,0 south", "1,0 south", "2,0 east", "0,2 south", "1,2 west", "1,2 south"],
  blockers: { "1,2 south": "door_red" },
  items: { "2,1": "key_red" },
};

describe("mazeMacro", () => {
  it("starts a game, fetches the key, opens the door and reaches the exit", async () => {
    const maze = fakeMaze(oneKeyOneDoor);
    const result = await runMacro(mazeMacro, maze.host);
    expect(result).toMatchObject({ status: "done" });
    expect(maze.state).toMatchObject({ won: true, inventory: null });
    expect(maze.messages).toEqual([`Out of the maze in ${maze.state.moves} moves.`]);
  });

  it("continues a game in progress", async () => {
    const maze = fakeMaze(oneKeyOneDoor, true);
    expect(await runMacro(mazeMacro, maze.host)).toMatchObject({ status: "done" });
    expect(maze.state.won).toBe(true);
  });

  it("drops a key it cannot use yet to carry dynamite to a rock", async () => {
    // The key is picked up first, but the rock in front of its door needs
    // the dynamite, so the key has to be put down and fetched again later.
    const maze = fakeMaze({
      ...oneKeyOneDoor,
      blockers: { "0,1 east": "rock", "1,2 south": "door_red" },
      items: { "0,1": "key_red", "2,1": "dynamite" },
    });
    expect(await runMacro(mazeMacro, maze.host)).toMatchObject({ status: "done" });
    expect(maze.state.won).toBe(true);
  });

  it("fails with the game's reason when an action is refused", async () => {
    const maze = fakeMaze(oneKeyOneDoor);
    const host: ToolHost = {
      ...maze.host,
      callTool: (name, args, site) =>
        name === "pickup" ? Promise.resolve({ success: false, reason: "Your hands are full." }) : maze.host.callTool(name, args, site),
    };
    expect(await runMacro(mazeMacro, host)).toMatchObject({ status: "failed", message: "Your hands are full." });
  });

  // Seeds 0 to 39, plus 643 and 118: the two that took the most steps of 1,000 tried.
  it.each([...Array.from({ length: 40 }, (_, seed) => seed), 643, 118])(
    "finishes generated 10x10 maze %i within the default step limit",
    async (seed) => {
      const maze = fakeMaze(generate(seed));
      // The default limit applies to runs started from the launcher.
      const result = await runMacro(mazeMacro, maze.host);
      expect(result).toMatchObject({ status: "done" });
      expect(maze.state.won).toBe(true);
    },
  );
});
