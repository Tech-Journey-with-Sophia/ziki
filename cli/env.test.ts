import { describe, expect, it } from "vitest";
import { CliEnvironmentError, isLocalHost, localDatabaseUrl, localServerUrl } from "./env";

describe("isLocalHost", () => {
  it("accepts this machine only", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "[::1]", "ziki.localhost", "LOCALHOST"]) expect(isLocalHost(host)).toBe(true);
    for (const host of ["ziki.dev", "10.0.0.5", "localhost.example.com"]) expect(isLocalHost(host)).toBe(false);
  });
});

describe("localDatabaseUrl", () => {
  it("returns a local DATABASE_URL, without surrounding quotes", () => {
    expect(localDatabaseUrl({ DATABASE_URL: '"postgresql://u:p@localhost:5433/ziki"' })).toBe("postgresql://u:p@localhost:5433/ziki");
  });

  it("fails when there is no database configured", () => {
    expect(() => localDatabaseUrl({})).toThrow(CliEnvironmentError);
    expect(() => localDatabaseUrl({ DATABASE_URL: "not a url" })).toThrow(/not a valid URL/);
  });

  it("refuses a remote database, and one that is the production URL", () => {
    expect(() => localDatabaseUrl({ DATABASE_URL: "postgresql://u:p@db.example.com:5432/ziki" })).toThrow(/not a local database/);
    const url = "postgresql://u:p@localhost:5433/ziki";
    expect(() => localDatabaseUrl({ DATABASE_URL: url, DATABASE_URL_PROD: url })).toThrow(/DATABASE_URL_PROD/);
  });
});

describe("localServerUrl", () => {
  it("prefers --server, then ZIKI_CLI_URL, then the default", () => {
    expect(localServerUrl("http://127.0.0.1:4000/ignored/path", { ZIKI_CLI_URL: "http://localhost:5000" })).toBe("http://127.0.0.1:4000");
    expect(localServerUrl(undefined, { ZIKI_CLI_URL: "http://localhost:5000" })).toBe("http://localhost:5000");
    expect(localServerUrl(undefined, {})).toBe("http://localhost:3001");
  });

  it("refuses a server that isn't on this machine", () => {
    expect(() => localServerUrl("https://ziki.dev", {})).toThrow(/not a local server/);
  });
});
