//This is a parser for problems that are original or do not have a source on the Internet
//TODO: maybe it would be better to have a different way of storing these problems, and also a different logic for generating unique ids

export default function parseOriginal() {
    // Generate a unique timestamp-based ID
    const timestamp = Date.now();
    
    return {
      uniqueId: `original-${timestamp}`,
      name: "Original Problem",
      source: "Add the name of the author of the problem here",
      url: "#", // Using # as placeholder for no URL
      isStarred: false,
      difficulty: "Set the difficulty here",
      tags: ["Add some tags here"],
      solutionMetadata: {
        kind: "internal",
        hasHints: false
      }
    };
  }