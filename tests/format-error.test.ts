import { describe, it, expect } from "vitest";
import { ApiError } from "../src/core/api/errors.js";
import { formatError } from "../src/tools/build/index.js";

describe("formatError auth guidance", () => {
  it("points 401s at reconnecting", () => {
    const message = formatError(new ApiError(401, "UNAUTHORIZED", "Invalid credentials"));
    expect(message).toContain("shipit_login");
    expect(message).toContain("UNAUTHORIZED");
  });

  it("points 403s at reconnecting", () => {
    const message = formatError(new ApiError(403, "ACCOUNT_DISABLED", "Disabled"));
    expect(message).toContain("shipit_login");
  });

  it("leaves non-auth errors alone", () => {
    const message = formatError(new ApiError(502, "CHECKOUT_FAILED", "Nope"));
    expect(message).not.toContain("shipit_login");
    expect(message).toContain("CHECKOUT_FAILED");
  });
});
