export interface PasswordPolicyConfig {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
}

type EnvBooleanReader = (key: string, defaultValue: boolean) => boolean;
type EnvNumberReader = (key: string, defaultValue: number) => number;

export const resolvePasswordPolicyConfig = (
  getRequiredEnvNumber: EnvNumberReader,
  getOptionalBoolean: EnvBooleanReader,
): PasswordPolicyConfig => {
  const minLength = getRequiredEnvNumber("PASSWORD_MIN_LENGTH", 12);
  const maxLength = getRequiredEnvNumber("PASSWORD_MAX_LENGTH", 100);
  if (maxLength < minLength) {
    throw new Error("PASSWORD_MAX_LENGTH must be greater than or equal to PASSWORD_MIN_LENGTH");
  }

  return {
    minLength,
    maxLength,
    requireUppercase: getOptionalBoolean("PASSWORD_REQUIRE_UPPERCASE", true),
    requireLowercase: getOptionalBoolean("PASSWORD_REQUIRE_LOWERCASE", true),
    requireNumber: getOptionalBoolean("PASSWORD_REQUIRE_NUMBER", true),
    requireSymbol: getOptionalBoolean("PASSWORD_REQUIRE_SYMBOL", true),
  };
};

export const buildPasswordPolicyMessage = (policy: PasswordPolicyConfig): string => {
  const requirements = [`at least ${policy.minLength} characters`];
  if (policy.requireUppercase) requirements.push("one uppercase letter");
  if (policy.requireLowercase) requirements.push("one lowercase letter");
  if (policy.requireNumber) requirements.push("one number");
  if (policy.requireSymbol) requirements.push("one symbol");
  return `Password must be ${requirements.join(", ")}`;
};

export const validatePasswordAgainstPolicy = (
  password: string,
  policy: PasswordPolicyConfig,
): string | null => {
  if (typeof password !== "string") return buildPasswordPolicyMessage(policy);
  if (password.length < policy.minLength) return buildPasswordPolicyMessage(policy);
  if (password.length > policy.maxLength) return `Password must be at most ${policy.maxLength} characters long`;
  if (policy.requireUppercase && !/[A-Z]/.test(password)) return buildPasswordPolicyMessage(policy);
  if (policy.requireLowercase && !/[a-z]/.test(password)) return buildPasswordPolicyMessage(policy);
  if (policy.requireNumber && !/\d/.test(password)) return buildPasswordPolicyMessage(policy);
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) return buildPasswordPolicyMessage(policy);
  return null;
};
