export const COUNTRY_LIST = [
  'Canada', 'USA', 'UK', 'Pakistan', 'India',
  'Bangladesh', 'Nepal', 'UAE', 'Australia', 'Philippines',
] as const;

export type Country = typeof COUNTRY_LIST[number];

export const COUNTRY_FLAGS: Record<Country, string> = {
  Canada:      '🇨🇦',
  USA:         '🇺🇸',
  UK:          '🇬🇧',
  Pakistan:    '🇵🇰',
  India:       '🇮🇳',
  Bangladesh:  '🇧🇩',
  Nepal:       '🇳🇵',
  UAE:         '🇦🇪',
  Australia:   '🇦🇺',
  Philippines: '🇵🇭',
};

/** Returns the flag emoji for a country, or null if unknown/missing. */
export function getCountryFlag(country?: string | null): string | null {
  if (!country) return null;
  return COUNTRY_FLAGS[country as Country] ?? null;
}

export const COUNTRY_ISO: Record<Country, string> = {
  Canada:      'CA',
  USA:         'US',
  UK:          'GB',
  Pakistan:    'PK',
  India:       'IN',
  Bangladesh:  'BD',
  Nepal:       'NP',
  UAE:         'AE',
  Australia:   'AU',
  Philippines: 'PH',
};

/** Returns the ISO 2-letter code for a country, or null if unknown. */
export function getCountryISO(country?: string | null): string | null {
  if (!country) return null;
  return COUNTRY_ISO[country as Country] ?? null;
}
