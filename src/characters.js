// Playable characters. Each one is unlocked with coins collected across runs.
export const CHARACTERS = [
  {
    id: 'dash', name: 'Dash', price: 0, tagline: 'Never late, never slow.',
    look: {
      skin: '#f1c27d', shirt: '#ff3d68', pants: '#2b59c3', shoes: '#f8f9fa', hat: 'cap', hatColor: '#ffd23f',
      backpack: '#3bc9db', hair: '#4a2c1d',
    },
  },
  {
    id: 'nova', name: 'Nova', price: 250, tagline: 'Hears the beat in every train.',
    look: {
      skin: '#8d5524', shirt: '#7b2cbf', stripe: '#e0aaff', pants: '#240046', shoes: '#ff006e', soles: '#ffffff',
      hair: '#16110d', hairStyle: 'bun', headphones: '#00f5d4',
    },
  },
  {
    id: 'bolt', name: 'Bolt', price: 600, tagline: 'Track star. Literally.',
    look: {
      skin: '#c68642', shirt: '#2dc653', stripe: '#ffffff', pants: '#1f8a3a', shoes: '#111111', soles: '#ff7b00',
      hat: 'capFwd', hatColor: '#ff7b00', backpack: '#ffd166',
    },
  },
  {
    id: 'pixel', name: 'Pixel', price: 1000, tagline: 'Speedruns everything, even the subway.',
    look: {
      skin: '#ffdbac', shirt: '#ff8c42', pants: '#3d405b', shoes: '#e0e1dd', hat: 'beanie', hatColor: '#118ab2',
      hatTrim: '#073b4c', glasses: '#222222', hair: '#d4a373', backpack: '#ef476f',
    },
  },
  {
    id: 'blaze', name: 'Blaze', price: 1600, tagline: 'Leaves scorch marks on the rails.',
    look: {
      skin: '#e0ac69', shirt: '#d00000', stripe: '#ffba08', sleeves: '#1b1b1b', pants: '#1b1b1b', shoes: '#ffba08',
      hair: '#1b1b1b', hairStyle: 'spiky', gloves: '#1b1b1b',
    },
  },
  {
    id: 'frost', name: 'Frost', price: 2500, tagline: 'Stays cool at top speed.',
    look: {
      skin: '#f6d5c3', shirt: '#caf0f8', stripe: '#0077b6', pants: '#023e8a', shoes: '#ffffff', soles: '#48cae4',
      hat: 'beanie', hatColor: '#ffffff', hatTrim: '#90e0ef', pompom: '#0077b6', hair: '#e9ecef', hairStyle: 'long',
      gloves: '#0077b6',
    },
  },
];

export const characterById = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
