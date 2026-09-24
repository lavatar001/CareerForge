// Canonical Profile JSON helpers — the single source of truth data shape.
// The parser output is merged over this skeleton so every field always exists.

export const SCHEMA_VERSION = '1.0';

export function emptyProfile() {
  return {
    schema_version: SCHEMA_VERSION,
    meta: {
      source_filename: '',
      parsed_at: '',
      detected_language: 'en',
      last_edited_at: '',
    },
    contact: {
      full_name: '',
      email: '',
      phone: '',
      location: { city: '', country: '', country_code: '' },
      links: { linkedin: '', portfolio: '', github: '', other: [] },
    },
    headline: '',
    summary: '',
    experience: [],
    education: [],
    skills: { hard: [], soft: [], tools: [] },
    languages: [],
    certifications: [],
    projects: [],
    awards: [],
    gulf_fields: {
      nationality: '',
      visa_status: '',
      visa_expiry: '',
      driving_license: '',
      date_of_birth: '',
      marital_status: '',
      photo_url: '',
      notice_period: '',
    },
    target: { roles: [], locations: [], seniority: 'mid', work_mode: 'any' },
    completeness: { score: 0, missing: [] },
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Deep-merge parsed data over the skeleton. Arrays and scalars from `source`
// replace the skeleton value; unknown keys in `source` are dropped so the
// shape never drifts from the schema.
export function mergeIntoSkeleton(skeleton, source) {
  const out = {};
  for (const key of Object.keys(skeleton)) {
    const base = skeleton[key];
    const val = source?.[key];
    if (val === undefined || val === null) {
      out[key] = base;
    } else if (isPlainObject(base)) {
      out[key] = isPlainObject(val) ? mergeIntoSkeleton(base, val) : base;
    } else if (Array.isArray(base)) {
      out[key] = Array.isArray(val) ? val : base;
    } else {
      out[key] = typeof val === typeof base ? val : base;
    }
  }
  return out;
}

// Normalize experience/education entries: stable ids, bullets/raw_bullets rules.
export function normalizeProfile(profile) {
  profile.experience = (profile.experience || []).map((exp, i) => {
    const raw = Array.isArray(exp.raw_bullets) && exp.raw_bullets.length
      ? exp.raw_bullets
      : (Array.isArray(exp.bullets) ? exp.bullets : []);
    return {
      id: exp.id || `exp_${i + 1}`,
      title: exp.title || '',
      company: exp.company || '',
      location: exp.location || '',
      start_date: exp.start_date || '',
      end_date: exp.end_date || '',
      is_current: Boolean(exp.is_current) || exp.end_date === 'present',
      bullets: Array.isArray(exp.bullets) && exp.bullets.length ? exp.bullets : raw,
      raw_bullets: raw,
      skills_used: Array.isArray(exp.skills_used) ? exp.skills_used : [],
    };
  });

  profile.education = (profile.education || []).map((edu, i) => ({
    id: edu.id || `edu_${i + 1}`,
    degree: edu.degree || '',
    field: edu.field || '',
    institution: edu.institution || '',
    location: edu.location || '',
    start_date: edu.start_date || '',
    end_date: edu.end_date || '',
    grade: edu.grade || '',
  }));

  return profile;
}

// Simple completeness score used by the profile editor and ATS breakdown.
export function computeCompleteness(profile) {
  const checks = [
    ['contact', Boolean(profile.contact?.full_name && profile.contact?.email)],
    ['headline', Boolean(profile.headline)],
    ['summary', Boolean(profile.summary)],
    ['experience', (profile.experience || []).length > 0],
    ['education', (profile.education || []).length > 0],
    ['skills', ((profile.skills?.hard || []).length + (profile.skills?.tools || []).length) > 0],
    ['languages', (profile.languages || []).length > 0],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
  const score = Math.round(((checks.length - missing.length) / checks.length) * 100);
  return { score, missing };
}
