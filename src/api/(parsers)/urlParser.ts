//TODO: make it better, perhaps add for specific domains like the archive section of olympiadsXYZ

export default function urlParser(url: string) {
    // Basic URL validation
    try {
      new URL(url);
    } catch {
      throw new Error('Invalid URL format');
    }
  
    // Extract filename from URL
    const filename = url.split('/').pop() || 'unknown';
    
    return {
      uniqueId: `add-unique-solution-id-here`,
      source: 'Add the source here',
      name: filename,
      url: url,
      isStarred: false,
      difficulty: 'Add the difficulty here',
      tags: ['Add some tags here'],
      solutionMetadata: {
        kind: 'link',
        url: url
      }
    };
  }