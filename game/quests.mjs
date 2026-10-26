const rows = value => Array.isArray(value) ? value : [];
const mine = (entries, viewer) => rows(entries).filter(entry => entry?.actor?.id === viewer?.id);

export function getQuest(world, viewer) {
  const creations = rows(world?.creations);
  const discoveries = mine(world?.discoveries, viewer);
  const notes = mine(world?.contributions, viewer);
  const reports = mine(world?.reports, viewer);
  const role = viewer?.role === 'founder' ? 'founder' : 'witness';

  if (role === 'witness') {
    if (discoveries.length === 0) return {
      id: 'witness-discover', title: 'Witness Quest 1 · Find your bearings',
      copy: 'Visit a guide and discover a place. Discovery records where you went; it does not make a claim true.',
      button: 'Explore the world →', action: 'places'
    };
    if (creations.length === 0 && discoveries.length < 4) return {
      id: 'witness-map', title: 'Witness Quest 2 · Map the grounds',
      copy: `You have recorded ${discoveries.length} of four guide locations. Discover another one; the map is a record of visits, not proof of a claim.`,
      button: 'Discover another guide →', action: 'places'
    };
    if (creations.length === 0) return {
      id: 'witness-await-work', title: 'The grounds are mapped. Work has not arrived yet.',
      copy: 'All four guide locations are recorded, but no creation is published in this world yet. Return when a Founder places actual work here.',
      button: 'Revisit the grounds →', action: 'places'
    };
    if (notes.length === 0) return {
      id: 'witness-note', title: 'Witness Quest 3 · Leave a useful trace',
      copy: 'Open a creation, select the version you actually inspected, and leave a specific observation. Your note is attributed to you.',
      button: 'Find a place to witness →', action: 'places'
    };
    if (reports.length === 0) return {
      id: 'witness-report', title: 'Witness Quest 4 · Test the claim',
      copy: 'Inspect a published version and report one ambiguity, failure, or question worth testing. Disagreement belongs in the record.',
      button: 'Inspect the work →', action: 'places'
    };
    return {
      id: 'witness-return', title: 'Witness Quest · Keep the record alive',
      copy: 'You have explored and contributed. Compare a published version with an earlier one, and add another note only when you have something useful to say.',
      button: 'Visit the creations →', action: 'places'
    };
  }

  if (creations.length === 0) return {
    id: 'founder-create', title: 'Founder Quest 1 · Make your first place',
    copy: 'Reach the Making Bench and create one real artifact: a comic, a melody, a question, or your own HTML. Your first creation becomes a place in the world.',
    button: 'Begin at the Making Bench →', action: 'workbench'
  };
  if (discoveries.length === 0) return {
    id: 'founder-discover', title: 'Founder Quest 2 · Walk the institution',
    copy: 'Your first place exists. Discover a guide, then return to inspect your creation as a player—not only as its maker.',
    button: 'Explore the world →', action: 'places'
  };
  if (notes.length === 0) return {
    id: 'founder-note', title: 'Founder Quest 3 · Leave a field note',
    copy: 'Open a published place and add a concrete observation about what works, what is missing, or what deserves a repair.',
    button: 'Visit your creation →', action: 'places'
  };
  if (creations.length === 1) return {
    id: 'founder-create-second', title: 'Founder Quest 4 · Grow beyond one place',
    copy: 'Your first place has a trace. Make a second artifact that connects to it, and keep the first version available for comparison.',
    button: 'Make the next place →', action: 'workbench'
  };
  return {
    id: 'founder-connect', title: 'Founder Quest · Grow the Common Ground',
    copy: `You have made ${creations.length} places. Visit one, preserve its earlier version, and build something that connects it to another idea.`,
    button: 'Explore your places →', action: 'places'
  };
}
