import { describe, it, expect } from "vitest";
import {
  resolveConfig,
  resolveEndpoint,
  DEFAULT_HOST,
  DEFAULT_PORT,
} from "../../src/types.js";

// ===========================================================================
// Constants
// ===========================================================================

describe("constants", () => {
  it('DEFAULT_HOST is "localhost"', () => {
    expect(DEFAULT_HOST).toBe("localhost");
  });

  it("DEFAULT_PORT is 8182", () => {
    expect(DEFAULT_PORT).toBe(8182);
  });
});

// ===========================================================================
// resolveEndpoint
// ===========================================================================

describe("resolveEndpoint", () => {
  it("derives ws:// URL from host and port", () => {
    expect(resolveEndpoint({ host: "myhost", port: 9999 })).toBe(
      "ws://myhost:9999/gremlin"
    );
  });

  it("uses defaults when host and port omitted", () => {
    expect(resolveEndpoint({})).toBe("ws://localhost:8182/gremlin");
  });

  it("uses default port when only host given", () => {
    expect(resolveEndpoint({ host: "custom" })).toBe(
      "ws://custom:8182/gremlin"
    );
  });

  it("uses default host when only port given", () => {
    expect(resolveEndpoint({ port: 3000 })).toBe(
      "ws://localhost:3000/gremlin"
    );
  });

  it("returns explicit endpoint when provided (overrides host/port)", () => {
    expect(
      resolveEndpoint({ host: "ignore", port: 1111, endpoint: "ws://custom:5555/g" })
    ).toBe("ws://custom:5555/g");
  });
});

// ===========================================================================
// resolveConfig
// ===========================================================================

describe("resolveConfig", () => {
  describe("defaults", () => {
    it("fills all defaults when called with empty object", () => {
      const config = resolveConfig({});
      expect(config.host).toBe("localhost");
      expect(config.port).toBe(8182);
      expect(config.endpoint).toBe("ws://localhost:8182/gremlin");
      expect(config.multiLabelStrategy).toBe("delimiter");
      expect(config.guardMode).toBe("strict");
    });

    it("fills all defaults when called with no argument", () => {
      const config = resolveConfig();
      expect(config.host).toBe("localhost");
      expect(config.port).toBe(8182);
      expect(config.endpoint).toBe("ws://localhost:8182/gremlin");
      expect(config.multiLabelStrategy).toBe("delimiter");
      expect(config.guardMode).toBe("strict");
    });
  });

  describe("overrides", () => {
    it("uses custom port in endpoint", () => {
      const config = resolveConfig({ port: 9999 });
      expect(config.port).toBe(9999);
      expect(config.endpoint).toBe("ws://localhost:9999/gremlin");
    });

    it("uses custom host in endpoint", () => {
      const config = resolveConfig({ host: "myserver" });
      expect(config.host).toBe("myserver");
      expect(config.endpoint).toBe("ws://myserver:8182/gremlin");
    });

    it("explicit endpoint overrides derived value", () => {
      const config = resolveConfig({
        host: "ignored",
        port: 1111,
        endpoint: "ws://real:5555/g",
      });
      expect(config.endpoint).toBe("ws://real:5555/g");
      // host and port are still set to the provided values
      expect(config.host).toBe("ignored");
      expect(config.port).toBe(1111);
    });

    it("uses property strategy when specified", () => {
      const config = resolveConfig({ multiLabelStrategy: "property" });
      expect(config.multiLabelStrategy).toBe("property");
    });

    it("uses loose guard mode when specified", () => {
      const config = resolveConfig({ guardMode: "loose" });
      expect(config.guardMode).toBe("loose");
    });
  });

  describe("returned type is fully resolved (no optionals)", () => {
    it("every field is defined", () => {
      const config = resolveConfig({});
      expect(config.host).toBeDefined();
      expect(config.port).toBeDefined();
      expect(config.endpoint).toBeDefined();
      expect(config.multiLabelStrategy).toBeDefined();
      expect(config.guardMode).toBeDefined();
    });
  });
});
