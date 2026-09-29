const MIN_SECRET_BYTES = 32;
const MAX_TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

function parseExpirationSeconds(value) {
  const match = value.match(/^([1-9]\d*(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks|y|yr|year|years)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const secondsPerUnit = {
    s: 1,
    sec: 1,
    secs: 1,
    second: 1,
    seconds: 1,
    m: 60,
    min: 60,
    mins: 60,
    minute: 60,
    minutes: 60,
    h: 60 * 60,
    hr: 60 * 60,
    hrs: 60 * 60,
    hour: 60 * 60,
    hours: 60 * 60,
    d: 24 * 60 * 60,
    day: 24 * 60 * 60,
    days: 24 * 60 * 60,
    w: 7 * 24 * 60 * 60,
    week: 7 * 24 * 60 * 60,
    weeks: 7 * 24 * 60 * 60,
    y: 365 * 24 * 60 * 60,
    yr: 365 * 24 * 60 * 60,
    year: 365 * 24 * 60 * 60,
    years: 365 * 24 * 60 * 60,
  };

  const seconds = amount * secondsPerUnit[unit];
  return Number.isFinite(seconds) ? seconds : null;
}

function getJwtConfiguration(environment = process.env) {
  const secret = environment.JWT_SECRET;
  const normalizedSecret = String(secret || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const placeholderPrefixes = [
    "secret",
    "jwtsecret",
    "changeme",
    "your",
    "replace",
    "default",
    "example",
    "placeholder",
    "test",
  ];

  if (
    typeof secret !== "string" ||
    secret.trim() === "" ||
    Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES ||
    placeholderPrefixes.some((prefix) => normalizedSecret.startsWith(prefix))
  ) {
    throw new Error(
      "JWT_SECRET must be configured with a non-placeholder value of at least 32 bytes.",
    );
  }

  const expiresIn = String(environment.JWT_EXPIRES_IN || "").trim();
  const expirationSeconds = parseExpirationSeconds(expiresIn);
  if (
    expirationSeconds === null ||
    expirationSeconds <= 0 ||
    expirationSeconds > MAX_TOKEN_LIFETIME_SECONDS
  ) {
    throw new Error(
      "JWT_EXPIRES_IN must be a positive duration no greater than 365 days (for example, 1h or 1d).",
    );
  }

  return Object.freeze({ secret, expiresIn });
}

module.exports = getJwtConfiguration();
