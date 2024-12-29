import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { ArchiveSection, ArchiveSubsection } from '../../../archive/archiveOrdering';
import styled from 'styled-components';
import tw from 'twin.macro';
import { useTranslation } from 'react-i18next';

interface Node extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  group: number;
  size?: number;
  children?: number;
  parentId?: string;
  clusterId?: string;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
}

type GraphData = {
  nodes: Node[];
  links: Link[];
};

interface ArchiveGraphProps {
  data: ArchiveSection;
  width?: number;
  height?: number;
}

const MAX_NODES = 1000; // Limit the number of nodes to display

const transformToGraphData = (archiveData: ArchiveSection): GraphData => {
  const nodes: Node[] = [];
  const links: Link[] = [];
  let nodeCount = 0;
  const nodeMap = new Map<string, Node>();
  const childrenCount = new Map<string, number>();
  
  // Helper function to create unique IDs
  const createUniqueId = (name: string, parentId: string, depth: number): string => {
    return `${parentId}__${name}__${depth}`;
  };

  // Helper function to add node if it doesn't exist
  const addNode = (name: string, parentId: string, depth: number): string => {
    const uniqueId = createUniqueId(name, parentId, depth);
    
    if (!nodeMap.has(uniqueId)) {
      if (nodeCount >= MAX_NODES) return uniqueId;
      
      // Calculate base size based on depth
      const baseSize = Math.max(20 - depth * 5, 5);
      
      // Get cluster ID (use parent's ID for grouping)
      const clusterId = depth <= 1 ? uniqueId : parentId;
      
      const node: Node = {
        id: uniqueId,
        name: name,
        group: depth,
        size: baseSize,
        children: 0,
        parentId,
        clusterId
      };
      
      nodeMap.set(uniqueId, node);
      nodes.push(node);
      nodeCount++;
    }
    
    // Increment children count for parent
    if (parentId !== 'root') {
      const count = childrenCount.get(parentId) || 0;
      childrenCount.set(parentId, count + 1);
    }
    
    return uniqueId;
  };
  
  // Add root node
  const rootId = addNode(archiveData.name, 'root', 0);
  
  const processSection = (
    parentId: string,
    section: { name: string; subsections?: ArchiveSubsection[] },
    depth: number
  ): boolean => {
    if (nodeCount >= MAX_NODES) return false;
    
    const sectionId = addNode(section.name, parentId, depth);
    
    // Only add link if both nodes exist and they're different
    if (sectionId !== parentId) {
      links.push({
        source: parentId,
        target: sectionId
      });
    }
    
    section.subsections?.some(subsection => {
      if (nodeCount >= MAX_NODES) return true;
      return !processSection(sectionId, subsection, depth + 1);
    });

    return true;
  };
  
  archiveData.sections.some(section => {
    if (nodeCount >= MAX_NODES) return true;
    return !processSection(rootId, section, 1);
  });
  
  // After processing all nodes, adjust sizes based on children
  nodes.forEach(node => {
    const childCount = childrenCount.get(node.id) || 0;
    node.children = childCount;
    // Increase size based on number of children
    node.size = (node.size || 5) + Math.sqrt(childCount) * 2;
  });

  return { nodes: Array.from(nodeMap.values()), links };
};

const GraphContainer = styled.div`
  ${tw`w-full rounded-lg shadow-lg mb-8`}
  height: 500px;  // Fixed height for the container
  background: transparent;  // Make container background transparent
`;

export const ArchiveGraph: React.FC<ArchiveGraphProps> = ({ 
  data,
  width,
  height
}) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    d3.select(svgRef.current).selectAll("*").remove();
    const graphData = transformToGraphData(data);
    
    // Setup SVG with dark background
    const svg = d3.select(svgRef.current);
    
    // Add dark background
    svg.append("rect")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("fill", "#0a0a0f");  // Darker background

    // Create color scales for nodes based on their group/depth
    const nodeColorScale = d3.scaleOrdinal<number, string>()
      .domain([0, 1, 2, 3])
      .range([
        "#FFE066", // Yellow for root
        "#4FC1FF", // Light blue for level 1
        "#FF66B3", // Pink for level 2
        "#68F590"  // Green for level 3
      ]);

    // Create link color gradient
    const defs = svg.append("defs");
    
    // Add multiple gradients for different link types
    const gradients = [
      { id: "linkGradient1", colors: ["#4FC1FF", "#68F590"] },
      { id: "linkGradient2", colors: ["#FFE066", "#4FC1FF"] },
      { id: "linkGradient3", colors: ["#FF66B3", "#4FC1FF"] }
    ];

    gradients.forEach(grad => {
      const gradient = defs.append("linearGradient")
        .attr("id", grad.id)
        .attr("gradientUnits", "userSpaceOnUse");

      gradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", grad.colors[0])
        .attr("stop-opacity", 0.3);

      gradient.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", grad.colors[1])
        .attr("stop-opacity", 0.3);
    });

    // Enhanced glow effects
    const glow = defs.append("filter")
      .attr("id", "glow")
      .attr("x", "-50%")
      .attr("y", "-50%")
      .attr("width", "200%")
      .attr("height", "200%");

    glow.append("feGaussianBlur")
      .attr("stdDeviation", "3")
      .attr("result", "coloredBlur");

    const feMerge = glow.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // First, add zoom scale tracking
    let currentZoom = 1;

    // In the zoom behavior setup, track the zoom scale
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        currentZoom = event.transform.k;
        // Update label visibility based on zoom
        updateLabelVisibility(currentZoom);
      });

    // Add a function to update label visibility
    const updateLabelVisibility = (zoomLevel: number) => {
      nodes.selectAll("text")
        .transition()
        .duration(200)
        .attr("opacity", (d: Node) => {
          // Always show root node labels
          if (d.group === 0) return 0.9;
          
          // Show more labels when zoomed in
          if (zoomLevel > 1.5) return 0.9;
          
          // Show labels for nodes with children when moderately zoomed
          if (zoomLevel > 1 && (d.children || 0) > 0) return 0.7;
          
          // Show labels for important nodes at normal zoom
          if ((d.children || 0) > 2) return 0.6;
          
          // Hide other labels when zoomed out
          return 0;
        });
    };

    svg.call(zoom);

    // Create main container
    const g = svg.append("g")
      .attr("transform", `translate(${width/2},${height/2})`);

    // Create cluster centers map
    const clusterCenters = new Map<string, { x: number; y: number }>();

    // Modify force simulation
    const simulation = d3.forceSimulation<Node>(graphData.nodes)
      .force("link", d3.forceLink<Node, Link>(graphData.links)
        .id(d => d.id)
        .distance(d => {
          const sourceNode = typeof d.source === 'object' ? d.source : graphData.nodes.find(n => n.id === d.source);
          const targetNode = typeof d.target === 'object' ? d.target : graphData.nodes.find(n => n.id === d.target);
          // Shorter distances for nodes in the same cluster
          const sameCluster = sourceNode?.clusterId === targetNode?.clusterId;
          return sameCluster ? 
            (sourceNode?.size || 30) + (targetNode?.size || 30) : 
            ((sourceNode?.size || 30) + (targetNode?.size || 30)) * 1.5; // Reduced multiplier
        }))
      .force("charge", d3.forceManyBody()
        .strength(d => -(d.size || 30) * 30))
      .force("center", d3.forceCenter(width/2, height/2))
      .force("collision", d3.forceCollide().radius(d => (d.size || 30) * 0.7))
      .alphaDecay(0.02) // Faster cooling
      .velocityDecay(0.4) // More damping
      // Add cluster force
      .force("cluster", alpha => {
        // Update cluster centers
        const clusters = new Map<string, { x: number; y: number; count: number }>();
        
        graphData.nodes.forEach(node => {
          if (!node.clusterId) return;
          
          const cluster = clusters.get(node.clusterId) || { x: 0, y: 0, count: 0 };
          cluster.x += node.x || 0;
          cluster.y += node.y || 0;
          cluster.count += 1;
          clusters.set(node.clusterId, cluster);
        });
        
        // Calculate cluster centers
        clusters.forEach((value, key) => {
          clusterCenters.set(key, {
            x: value.x / value.count,
            y: value.y / value.count
          });
        });
        
        // Apply clustering force
        graphData.nodes.forEach(node => {
          if (!node.clusterId || !clusterCenters.has(node.clusterId)) return;
          
          const center = clusterCenters.get(node.clusterId)!;
          const k = alpha * 1; // Adjust strength of clustering
          const dx = center.x - (node.x || 0);
          const dy = center.y - (node.y || 0);
          
          node.vx = (node.vx || 0) + dx * k;
          node.vy = (node.vy || 0) + dy * k;
        });
      })
      // Add additional forces for better layout
      .force("x", d3.forceX(width/2).strength(0.05))
      .force("y", d3.forceY(height/2).strength(0.05));

    // Add links with enhanced styling
    const links = g.append("g")
      .selectAll("line")
      .data(graphData.links)
      .join("line")
      .attr("stroke", d => {
        const sourceNode = typeof d.source === 'object' ? d.source : graphData.nodes.find(n => n.id === d.source);
        const targetNode = typeof d.target === 'object' ? d.target : graphData.nodes.find(n => n.id === d.target);
        // Use different gradients for intra-cluster and inter-cluster links
        if (sourceNode?.clusterId === targetNode?.clusterId) {
          return `url(#linkGradient${(sourceNode?.group % 3) + 1})`;
        }
        return "#2a2a2a"; // Subtle color for inter-cluster links
      })
      .attr("stroke-width", d => {
        const sourceNode = typeof d.source === 'object' ? d.source : graphData.nodes.find(n => n.id === d.source);
        const targetNode = typeof d.target === 'object' ? d.target : graphData.nodes.find(n => n.id === d.target);
        // Thicker lines for intra-cluster connections
        return sourceNode?.clusterId === targetNode?.clusterId ? 1.5 : 0.5;
      })
      .attr("opacity", d => {
        const sourceNode = typeof d.source === 'object' ? d.source : graphData.nodes.find(n => n.id === d.source);
        const targetNode = typeof d.target === 'object' ? d.target : graphData.nodes.find(n => n.id === d.target);
        // More opacity for intra-cluster connections
        return sourceNode?.clusterId === targetNode?.clusterId ? 0.4 : 0.1;
      });

    // Add nodes with enhanced styling
    const nodes = g.append("g")
      .selectAll("g")
      .data(graphData.nodes)
      .join("g");

    // Add node circles
    nodes.append("circle")
      .attr("r", d => d.size || 5)
      .attr("fill", d => nodeColorScale(d.group))
      .attr("filter", "url(#glow)")
      .attr("opacity", d => Math.min(1, 0.7 + (d.children || 0) * 0.1));  // More opaque for nodes with more children

    // Add labels
    nodes.append("text")
      .attr("x", d => (d.size || 5) + 5)
      .attr("y", 3)
      .attr("fill", d => nodeColorScale(d.group))
      .attr("font-family", "Inter, system-ui, sans-serif")
      .attr("font-size", d => `${Math.min(14, 10 + Math.sqrt(d.children || 0))}px`)
      .attr("opacity", d => {
        // Initial visibility
        if (d.group === 0) return 0.9;  // Root nodes
        if ((d.children || 0) > 2) return 0.6;  // Important nodes
        return 0;
      })
      .text(d => d.name);

    // Enhanced hover interactions
    nodes
      .on("mouseover", function(event, d: Node) {
        const connectedNodes = new Set([d.id]);
        const sameCluster = new Set([d.clusterId]);
        
        graphData.links.forEach(link => {
          const sourceNode = typeof link.source === 'object' ? link.source : graphData.nodes.find(n => n.id === link.source);
          const targetNode = typeof link.target === 'object' ? link.target : graphData.nodes.find(n => n.id === link.target);
          
          if (sourceNode?.id === d.id) {
            connectedNodes.add(targetNode?.id || '');
            sameCluster.add(targetNode?.clusterId || '');
          }
          if (targetNode?.id === d.id) {
            connectedNodes.add(sourceNode?.id || '');
            sameCluster.add(sourceNode?.clusterId || '');
          }
        });

        // Highlight nodes
        nodes.selectAll("circle")
          .transition()
          .duration(300)
          .attr("r", (n: Node) => {
            const baseSize = n.size || 5;
            return n.id === d.id ? baseSize * 1.3 : 
                   n.clusterId === d.clusterId ? baseSize * 1.1 : 
                   baseSize;
          })
          .attr("opacity", (n: Node) => 
            n.id === d.id ? 1 :
            n.clusterId === d.clusterId ? 0.8 :
            connectedNodes.has(n.id) ? 0.6 : 
            0.2
          );

        // Update links
        links
          .transition()
          .duration(300)
          .attr("opacity", l => {
            const sourceNode = typeof l.source === 'object' ? l.source : graphData.nodes.find(n => n.id === l.source);
            const targetNode = typeof l.target === 'object' ? l.target : graphData.nodes.find(n => n.id === l.target);
            
            if (sourceNode?.id === d.id || targetNode?.id === d.id) return 0.8;
            if (sourceNode?.clusterId === d.clusterId && targetNode?.clusterId === d.clusterId) return 0.4;
            return 0.1;
          });

        // Show labels for connected nodes
        nodes.selectAll("text")
          .transition()
          .duration(300)
          .attr("opacity", (n: Node) => {
            if (n.id === d.id) return 1;  // Hovered node
            if (n.clusterId === d.clusterId) return 0.9;  // Same cluster
            if (connectedNodes.has(n.id)) return 0.8;  // Connected nodes
            // Maintain visibility for important nodes
            if (n.group === 0 || (n.children || 0) > 2) return 0.4;
            return 0;
          });
      })
      .on("mouseout", function() {
        // Reset styles
        nodes.selectAll("circle")
          .transition()
          .duration(300)
          .attr("r", d => d.size || 5)
          .attr("opacity", 1);

        nodes.selectAll("text")
          .transition()
          .duration(300)
          .attr("opacity", d => d.group === 0 ? 0.9 : 0);

        links
          .transition()
          .duration(300)
          .attr("opacity", 0.3);

        // Reset to zoom-based visibility
        updateLabelVisibility(currentZoom);
      });

    // Modify drag behavior to work with zoom
    const drag = d3.drag<SVGGElement, Node>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodes.call(drag);

    simulation.on("tick", () => {
      links
        .attr("x1", d => (d.source as Node).x!)
        .attr("y1", d => (d.source as Node).y!)
        .attr("x2", d => (d.target as Node).x!)
        .attr("y2", d => (d.target as Node).y!);

      nodes.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    // Add double-click behavior to reset zoom
    svg.on("dblclick.zoom", () => {
      svg.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity);
    });

    // Trigger zoom reset when graph initially loads
      svg.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity);

    // Initial label visibility update
    updateLabelVisibility(1);

    // Save positions when simulation ends
    simulation.on("end", () => {
      const layoutCache = {
        nodes: graphData.nodes.map(node => ({
          id: node.id,
          x: node.x,
          y: node.y
        })),
        timestamp: Date.now()
      };
      try {
        localStorage.setItem('archiveGraphLayout', JSON.stringify(layoutCache));
      } catch (e) {
        console.warn('Failed to cache graph layout:', e);
      }
    });

    // Try to load cached positions
    const CACHE_LIFETIME = 24 * 60 * 60 * 1000; // 24 hours
    try {
      const cached = localStorage.getItem('archiveGraphLayout');
      if (cached) {
        const layout = JSON.parse(cached);
        if (Date.now() - layout.timestamp < CACHE_LIFETIME) {
          // Apply cached positions
          layout.nodes.forEach(cached => {
            const node = graphData.nodes.find(n => n.id === cached.id);
            if (node) {
              node.x = cached.x;
              node.y = cached.y;
              node.fx = cached.x; // Fix position initially
              node.fy = cached.y;
            }
          });
          
          // Release fixed positions after a short delay
          setTimeout(() => {
            graphData.nodes.forEach(node => {
              node.fx = null;
              node.fy = null;
            });
          }, 1000);
        }
      }
    } catch (e) {
      console.warn('Failed to load cached layout:', e);
    }

    return () => {
      simulation.stop();
    };
  }, [data, width, height]);

  const { t } = useTranslation();

  return (
    <div className="archive-graph-container relative w-full h-full">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full"  // Make SVG fill container
        style={{ background: 'transparent' }}
      />
      <div className="absolute bottom-4 right-4
        bg-gray-800/80 text-white text-sm px-4 py-2 rounded-md 
        backdrop-blur-sm border border-gray-700/50
        shadow-lg z-10 hidden md:block">
        <p className="text-center text-[0.65rem]">
          {t('scroll-to-zoom')} • {t('double-click-to-reset')}
        </p>
      </div>
    </div>
  );
};