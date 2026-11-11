import { describe, expect, it } from "vitest";
import type { Json } from "../macro/types";
import { runMacro, type ToolHost } from "../runner/interpreter";
import { adventureMacro } from "./adventure";

/**
 * A small model of WebMCP Adventure (andreban/webmcp-adventure), reduced to
 * the rules the walkthrough depends on: one door per `walk_to`, the PIN-locked
 * storage room, keyword-matched NPCs and the two-step fuse swap. Every action
 * reports refusals as `success: false`, as the game does.
 */
function fakeGame(startRoom = "janitor_closet") {
  const doors: Record<string, string[]> = {
    janitor_closet: ["corridor"],
    corridor: ["bridge", "janitor_closet", "comms_room", "storage_room", "mechanical_room", "engineering_room"],
    bridge: ["corridor"],
    comms_room: ["corridor"],
    storage_room: ["corridor"],
    mechanical_room: ["corridor"],
    engineering_room: ["corridor", "hyperdrive_room"],
    hyperdrive_room: ["engineering_room"],
  };
  const items: Record<string, string> = { battery: "storage_room", new_fuse: "storage_room" };
  const npcs: Record<string, string> = { comms_agent: "comms_room", mechanical_agent: "mechanical_room" };
  const state = { room: startRoom, storageLocked: true, brokenFuse: true, newFuse: false };
  const flags = { coursePlotted: false, shipOriented: false, hyperdriveActive: false };
  const inventory = new Set<string>();
  const messages: string[] = [];
  const ok = (message: string, data?: Json): Json => (data === undefined ? { success: true, message } : { success: true, message, data });
  const no = (message: string): Json => ({ success: false, message });

  const tools: Record<string, (args: Record<string, Json>) => Json> = {
    look_at: () => ok("You look around.", { room: { id: state.room } }),
    walk_to: ({ target }) => {
      const room = String(target);
      if (!doors[state.room]?.includes(room)) return no(`Cannot walk to "${room}".`);
      if (room === "storage_room" && state.storageLocked) return no("The door to storage_room is locked.");
      state.room = room;
      return ok(`Walked into ${room}.`, { roomId: room });
    },
    pick_up: ({ target }) => {
      const item = String(target);
      if (items[item] !== state.room) return no(`You do not see "${item}" here to pick up.`);
      delete items[item];
      inventory.add(item);
      return ok(`Picked up ${item}.`);
    },
    talk_to: ({ target, message }) => {
      const npc = String(target);
      const text = String(message).toLowerCase();
      if (npcs[npc] !== state.room) return no(`There is no NPC named "${npc}" here.`);
      if (npc === "comms_agent" && text.includes("pin")) return ok("[VOX-COM]: the PIN is 4271.");
      if (npc === "mechanical_agent" && text.includes("tool")) inventory.add("fuse_tool");
      return ok(`[${npc}]: noted.`);
    },
    use: ({ target, item }) => {
      const t = String(target);
      if (t === "storage_keypad" && item === "4271") {
        state.storageLocked = false;
        return ok("PIN 4271 accepted!");
      }
      if (t === "navigator" && item === "battery" && inventory.delete("battery")) {
        flags.coursePlotted = true;
        return ok("Course plotted!");
      }
      if (t === "thruster_console" && state.room === "engineering_room") {
        flags.shipOriented = true;
        return ok("Thrusters calibrated.");
      }
      if (t === "hyperdrive_unit" && state.room === "hyperdrive_room") {
        if (item === "fuse_tool" && inventory.has("fuse_tool")) {
          if (state.brokenFuse) {
            state.brokenFuse = false;
            return ok("Removed the blown fuse.");
          }
          if (!state.newFuse && inventory.delete("new_fuse")) {
            state.newFuse = true;
            return ok("Seated the new fuse.");
          }
        }
        if (item === undefined && !state.brokenFuse && state.newFuse) {
          flags.hyperdriveActive = true;
          return ok("Hyperdrive is now ACTIVE!");
        }
      }
      return no(`Using ${t} has no effect right now.`);
    },
  };

  const host: ToolHost = {
    async callTool(name, args) {
      const tool = tools[name];
      if (!tool) throw new Error(`unexpected tool ${name}`);
      return tool(args);
    },
    async isToolAvailable(name) {
      return name in tools;
    },
    async waitForTool(name) {
      if (!(name in tools)) throw new Error("timeout");
    },
    message: (text) => messages.push(text),
  };
  return { host, flags, messages, state };
}

describe("adventureMacro", () => {
  it("wins the game from a fresh start", async () => {
    const game = fakeGame();
    const result = await runMacro(adventureMacro, game.host);
    expect(result.status).toBe("done");
    expect(game.flags).toEqual({ coursePlotted: true, shipOriented: true, hyperdriveActive: true });
    expect(game.messages.at(-1)).toBe("Hyperdrive active. The ship is back on course.");
  });

  it("asks for a restart when the game is already in progress", async () => {
    const game = fakeGame("bridge");
    const result = await runMacro(adventureMacro, game.host);
    expect(result).toMatchObject({ status: "failed", toolCalls: 1 });
    expect(result.message).toMatch(/Restart the game/);
  });

  it("stops with the game's reason when an action is refused", async () => {
    const game = fakeGame();
    const host: ToolHost = {
      ...game.host,
      callTool: (name, args, site) =>
        name === "use" && args.target === "storage_keypad"
          ? Promise.resolve({ success: false, message: "Incorrect PIN." })
          : game.host.callTool(name, args, site),
    };
    const result = await runMacro(adventureMacro, host);
    expect(result).toMatchObject({ status: "failed", message: "Incorrect PIN." });
    expect(game.state.room).toBe("corridor");
  });
});
