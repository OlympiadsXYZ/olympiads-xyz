import { graphql, useStaticQuery } from 'gatsby';
import type { SiteStatsCounts } from '../utils/siteStatsFormat';

/** The build-time counts (gatsby-node sourceNodes, src/gatsby/site-stats.ts). */
export function useSiteStats(): SiteStatsCounts {
  const data: { siteStats: SiteStatsCounts } = useStaticQuery(graphql`
    query SiteStats {
      siteStats {
        problems
        problemsWithSolution
        papers
        subjects
        archiveFiles
        archiveCompetitionFiles
        archiveCompetitions
      }
    }
  `);
  return data.siteStats;
}
