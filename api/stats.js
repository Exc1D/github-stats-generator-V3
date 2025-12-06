const fetch = require("node-fetch");

async function fetchGitHubData(username) {
  const token = process.env.GITHUB_TOKEN || "";
  const headers = {
    Authorization: token ? `token ${token}` : "",
    "Content-Type": "application/json",
  };

  // GraphQL query to get contribution data AND language stats
  const query = `
    query($username: String!) {
      user(login: $username) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
              }
            }
          }
        }
        repositories(first: 100, ownerAffiliations: OWNER, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
              edges {
                size
                node {
                  name
                  color
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables: { username } }),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch GitHub data");
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(data.errors[0].message);
  }

  return {
    calendar: data.data.user.contributionsCollection.contributionCalendar,
    repositories: data.data.user.repositories.nodes,
  };
}

function calculateLanguageStats(repositories) {
  const languageMap = {};

  repositories.forEach((repo) => {
    repo.languages.edges.forEach((edge) => {
      const { name, color } = edge.node;
      const size = edge.size;

      if (languageMap[name]) {
        languageMap[name].size += size;
      } else {
        languageMap[name] = { size, color: color || "#858585" };
      }
    });
  });

  const totalSize = Object.values(languageMap).reduce(
    (sum, lang) => sum + lang.size,
    0
  );

  const languages = Object.entries(languageMap)
    .map(([name, data]) => ({
      name,
      color: data.color,
      percentage: ((data.size / totalSize) * 100).toFixed(2),
      size: data.size,
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 5);

  return languages;
}

function calculateStreaks(weeks) {
  const allDays = weeks.flatMap((week) => week.contributionDays);
  const today = new Date().toISOString().split("T")[0];

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  let longestStart = null;
  let longestEnd = null;
  let tempStart = null;

  for (let i = allDays.length - 1; i >= 0; i--) {
    const day = allDays[i];

    if (day.contributionCount > 0) {
      tempStreak++;
      if (!tempStart) tempStart = day.date;

      if (i === allDays.length - 1 || currentStreak > 0) {
        currentStreak = tempStreak;
      }

      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
        longestStart = day.date;
        longestEnd = tempStart;
      }
    } else {
      tempStreak = 0;
      tempStart = null;
    }
  }

  return {
    current: currentStreak,
    longest: longestStreak,
    longestStart: longestStart || allDays[0]?.date,
    longestEnd: longestEnd || today,
  };
}

function getLast90Days(weeks) {
  const allDays = weeks.flatMap((week) => week.contributionDays);
  return allDays.slice(-90);
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function generateSVG(totalContributions, streaks, activityDays, languages) {
  const width = 800;
  const height = 720;
  const graphWidth = 700;
  const graphHeight = 100;
  const padding = 20;

  const maxContributions = Math.max(
    ...activityDays.map((d) => d.contributionCount),
    1
  );

  // Generate line path for activity graph
  const points = activityDays.map((day, index) => {
    const x =
      padding +
      (index / (activityDays.length - 1)) * (graphWidth - 2 * padding);
    const y =
      graphHeight -
      padding -
      (day.contributionCount / maxContributions) * (graphHeight - 2 * padding);
    return `${x},${y}`;
  });

  const linePath = `M ${points.join(" L ")}`;
  const areaPath = `${linePath} L ${graphWidth - padding},${
    graphHeight - padding
  } L ${padding},${graphHeight - padding} Z`;

  const startDate = formatDate(streaks.longestStart);
  const endDate = formatDate(streaks.longestEnd);

  // Generate language bar segments
  let currentX = 0;
  const languageBarSegments = languages
    .map((lang) => {
      const segmentWidth = (parseFloat(lang.percentage) / 100) * 760;
      const segment = `<rect x="${
        currentX + 20
      }" y="530" width="${segmentWidth}" height="20" fill="${
        lang.color
      }" rx="4"/>`;
      currentX += segmentWidth;
      return segment;
    })
    .join("");

  // Generate language list
  const languageList = languages
    .map((lang, index) => {
      const row = Math.floor(index / 2);
      const col = index % 2;
      const x = col === 0 ? 80 : 450;
      const y = 590 + row * 50;

      return `
        <circle cx="${x - 30}" cy="${y}" r="8" fill="${lang.color}"/>
        <text x="${x}" y="${y + 5}" class="text lang-name">${lang.name} ${
        lang.percentage
      }%</text>
      `;
    })
    .join("");

  return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    @media (prefers-color-scheme: dark) {
      .bg { fill: #0d1117; }
      .text { fill: #c9d1d9; }
      .border { stroke: #30363d; }
    }
    @media (prefers-color-scheme: light) {
      .bg { fill: #ffffff; }
      .text { fill: #24292f; }
      .border { stroke: #d0d7de; }
    }
    .stat-number { font-size: 48px; font-weight: bold; }
    .stat-label { font-size: 16px; }
    .stat-detail { font-size: 12px; opacity: 0.7; }
    .lang-name { font-size: 16px; }
    .accent { fill: #f85149; }
    .blue { fill: #58a6ff; }
    .graph-line { stroke: #3fb950; stroke-width: 2; fill: none; }
    .graph-area { fill: #3fb95033; }
  </style>
  
  <rect width="${width}" height="${height}" class="bg" rx="10"/>
  
  <!-- Stats Container -->
  <rect x="10" y="10" width="780" height="140" fill="none" class="border" stroke-width="2" rx="8"/>
  
  <!-- Total Contributions -->
  <text x="140" y="80" class="text stat-number" text-anchor="middle">${totalContributions.toLocaleString()}</text>
  <text x="140" y="105" class="accent stat-label" text-anchor="middle">Total Contributions</text>
  <text x="140" y="130" class="text stat-detail" text-anchor="middle">Oct 12, 2020 - Present</text>
  
  <!-- Current Streak with flame icon -->
  <circle cx="400" cy="70" r="45" class="accent" opacity="0.2"/>
  <path d="M 400 45 Q 400 40 405 40 L 405 35 Q 405 30 400 30 Q 395 30 395 35 L 395 40 Q 395 40 400 45 Z" class="accent" transform="translate(0, 5)"/>
  <text x="400" y="80" class="text stat-number" text-anchor="middle">${
    streaks.current
  }</text>
  <text x="400" y="105" class="blue stat-label" text-anchor="middle">Current Streak</text>
  <text x="400" y="130" class="text stat-detail" text-anchor="middle">Days</text>
  
  <!-- Longest Streak -->
  <text x="660" y="80" class="text stat-number" text-anchor="middle">${
    streaks.longest
  }</text>
  <text x="660" y="105" class="accent stat-label" text-anchor="middle">Longest Streak</text>
  <text x="660" y="130" class="text stat-detail" text-anchor="middle">${startDate} - ${endDate}</text>
  
  <!-- Dividers -->
  <line x1="270" y1="30" x2="270" y2="130" class="border" stroke-width="2"/>
  <line x1="530" y1="30" x2="530" y2="130" class="border" stroke-width="2"/>
  
  <!-- Activity Graph Container -->
  <rect x="10" y="170" width="780" height="150" fill="none" class="border" stroke-width="2" rx="8"/>
  
  <!-- Activity Graph Title -->
  <text x="400" y="200" class="text" font-size="20" font-weight="bold" text-anchor="middle">Contribution Activity (Last 90 Days)</text>
  
  <!-- Activity Graph -->
  <g transform="translate(40, 210)">
    <path d="${areaPath}" class="graph-area"/>
    <path d="${linePath}" class="graph-line"/>
    <line x1="${padding}" y1="${graphHeight - padding}" x2="${
    graphWidth - padding
  }" y2="${graphHeight - padding}" class="border" stroke-width="1"/>
    <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${
    graphHeight - padding
  }" class="border" stroke-width="1"/>
  </g>
  
  <!-- Languages Container -->
  <rect x="10" y="340" width="780" height="360" fill="none" class="border" stroke-width="2" rx="8"/>
  
  <!-- Languages Title -->
  <text x="400" y="380" class="accent" font-size="32" font-weight="bold" text-anchor="middle">Most Used Languages</text>
  
  <!-- Language Bar -->
  <g transform="translate(0, 120)">
    ${languageBarSegments}
  </g>
  
  <!-- Language List -->
  <g>
    ${languageList}
  </g>
</svg>
  `.trim();
}

module.exports = async (req, res) => {
  try {
    const { username } = req.query;

    if (!username) {
      return res.status(400).send("Username parameter is required");
    }

    const { calendar, repositories } = await fetchGitHubData(username);
    const streaks = calculateStreaks(calendar.weeks);
    const activityDays = getLast90Days(calendar.weeks);
    const languages = calculateLanguageStats(repositories);

    const svg = generateSVG(
      calendar.totalContributions,
      streaks,
      activityDays,
      languages
    );

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=14400");
    res.status(200).send(svg);
  } catch (error) {
    console.error("Error generating stats:", error.message);
    res.status(500).send(`Error: ${error.message}`);
  }
};
