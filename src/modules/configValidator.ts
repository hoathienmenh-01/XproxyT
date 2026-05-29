/**
 * Config Validator — Phase B3
 * 
 * Validates config on load, provides defaults for missing fields,
 * and warns about deprecated or dangerous settings.
 */

import {logger as appLogger} from './logger';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  defaults: Record<string, any>;
}

/**
 * Validate config and fill missing defaults.
 */
export function validateConfig(config: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const defaults: Record<string, any> = {};

  if (!config || typeof config !== 'object') {
    errors.push('Config must be an object');
    return {valid: false, errors, warnings, defaults};
  }

  // Validate providers
  if (!Array.isArray(config.providers)) {
    errors.push('providers must be an array');
  } else {
    for (const p of config.providers) {
      if (!p.id) errors.push('Provider missing id');
      if (!p.credentials || typeof p.credentials !== 'object') {
        warnings.push(`Provider ${p.id}: no credentials configured`);
      }
    }
  }

  // Validate proxy
  if (!config.proxy || typeof config.proxy !== 'object') {
    defaults.proxy = {host: '127.0.0.1', port: 8080, key: ''};
    warnings.push('proxy not configured, using defaults');
  } else {
    if (typeof config.proxy.port !== 'number' || config.proxy.port < 1 || config.proxy.port > 65535) {
      errors.push(`Invalid proxy port: ${config.proxy.port}`);
    }
  }

  // Validate settings.session
  if (config.settings?.session) {
    const s = config.settings.session;
    if (s.rollingHistoryK && (s.rollingHistoryK < 1 || s.rollingHistoryK > 100)) {
      warnings.push(`session.rollingHistoryK=${s.rollingHistoryK} is unusual, recommend 5-20`);
    }
    if (s.compactAfterMessages && s.compactAfterMessages < 5) {
      warnings.push(`session.compactAfterMessages=${s.compactAfterMessages} is too low, recommend >=10`);
    }
  }

  // Validate settings.tokenLimits
  if (config.settings?.tokenLimits) {
    const t = config.settings.tokenLimits;
    if (t.maxInputTokens && t.maxInputTokens < 1000) {
      errors.push(`tokenLimits.maxInputTokens=${t.maxInputTokens} is too low`);
    }
    if (t.maxOutputTokensCap && t.maxInputTokens && t.maxOutputTokensCap > t.maxInputTokens) {
      warnings.push('maxOutputTokensCap > maxInputTokens, this may waste tokens');
    }
  }

  // Validate settings.tokenOverflow
  if (config.settings?.tokenOverflow) {
    const o = config.settings.tokenOverflow;
    if (o.threshold && o.threshold < 1000) {
      warnings.push(`tokenOverflow.threshold=${o.threshold} is very low, recommend >=5000`);
    }
  }

  // Validate settings.multiThread
  if (config.settings?.multiThread) {
    const m = config.settings.multiThread;
    if (m.globalMaxConcurrentRuns && m.globalMaxConcurrentRuns > 50) {
      warnings.push(`multiThread.globalMaxConcurrentRuns=${m.globalMaxConcurrentRuns} is high, may overload upstream`);
    }
    if (m.queueTimeoutMs && m.queueTimeoutMs < 5000) {
      warnings.push(`multiThread.queueTimeoutMs=${m.queueTimeoutMs} is very low`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    defaults,
  };
}

/**
 * Apply defaults to config for missing fields.
 */
export function applyConfigDefaults(config: any): any {
  const result = {...config};

  // Ensure settings object exists
  if (!result.settings) result.settings = {};

  // Ensure session defaults
  if (!result.settings.session) {
    result.settings.session = {};
  }
  const s = result.settings.session;
  if (!s.rollingHistoryK) s.rollingHistoryK = 10;
  if (!s.compactAfterMessages) s.compactAfterMessages = 40;
  if (!s.compactKeepRecent) s.compactKeepRecent = 5;
  if (s.enabled === undefined) s.enabled = true;

  // Ensure tokenLimits defaults
  if (!result.settings.tokenLimits) {
    result.settings.tokenLimits = {};
  }
  const t = result.settings.tokenLimits;
  if (t.enabled === undefined) t.enabled = true;
  if (!t.maxInputTokens) t.maxInputTokens = 128000;
  if (!t.warnInputTokens) t.warnInputTokens = 100000;
  if (!t.defaultMaxOutputTokens) t.defaultMaxOutputTokens = 8192;
  if (!t.maxOutputTokensCap) t.maxOutputTokensCap = 32000;

  // Ensure tokenOverflow defaults
  if (!result.settings.tokenOverflow) {
    result.settings.tokenOverflow = {};
  }
  if (result.settings.tokenOverflow.enabled === undefined) result.settings.tokenOverflow.enabled = true;
  if (!result.settings.tokenOverflow.threshold) result.settings.tokenOverflow.threshold = 10000;

  // Ensure multiThread defaults
  if (!result.settings.multiThread) {
    result.settings.multiThread = {};
  }
  if (result.settings.multiThread.enabled === undefined) result.settings.multiThread.enabled = true;
  if (!result.settings.multiThread.globalMaxConcurrentRuns) result.settings.multiThread.globalMaxConcurrentRuns = 20;
  if (!result.settings.multiThread.queueTimeoutMs) result.settings.multiThread.queueTimeoutMs = 120000;
  if (!result.settings.multiThread.runTimeoutMs) result.settings.multiThread.runTimeoutMs = 300000;

  return result;
}

/**
 * Validate and log config on startup.
 */
export function validateAndLogConfig(config: any): ValidationResult {
  const result = validateConfig(config);

  if (result.errors.length > 0) {
    appLogger.error('[ConfigValidator] Config errors', {data: {errors: result.errors}});
  }

  if (result.warnings.length > 0) {
    appLogger.warn('[ConfigValidator] Config warnings', {data: {warnings: result.warnings}});
  }

  if (result.valid) {
    appLogger.info('[ConfigValidator] Config validated OK', {data: {
      providers: config.providers?.length || 0,
      sessionEnabled: config.settings?.session?.enabled !== false,
      tokenLimitsEnabled: config.settings?.tokenLimits?.enabled !== false,
    }});
  }

  return result;
}