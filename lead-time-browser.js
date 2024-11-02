class LeadTimeCalculator {
    constructor(token) {
        this.token = token;
    }

    parseRepoUrl(repoUrl) {
        try {
            const url = new URL(repoUrl);
            const [, owner, repo] = url.pathname.split('/');
            return {owner, repo};
        } catch (error) {
            throw new Error(`Invalid repository URL: ${repoUrl}`);
        }
    }

    formatDuration(minutes) {
        const days = Math.floor(minutes / (24 * 60));
        const hours = Math.floor((minutes % (24 * 60)) / 60);
        const mins = Math.floor(minutes % 60);

        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (mins > 0) parts.push(`${mins}m`);

        return parts.join(' ') || '0m';
    }

    async fetchWithAuth(url) {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.statusText | response.status}`);
        }
        return response.json();
    }

    async getTeamMembers(owner, teamSlug) {
        try {
            const response = await this.fetchWithAuth(
                `https://api.github.com/orgs/${owner}/teams/${teamSlug}/members`
            );
            return response.map(member => member.login);
        } catch (error) {
            throw new Error(`Failed to fetch team members: ${error.message}`);
        }
    }

    async getAllPullRequestsWithCommits({owner, repo, startDate, teamSlug}) {
        let pullRequests = [];
        let page = 1;

        // First, get team members
        const teamMembers = await this.getTeamMembers(owner, teamSlug);

        while (true) {
            // Fetch pull requests
            const prs = await this.fetchWithAuth(
                `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`
            );
            console.log(teamMembers);
            // Filter PRs by team members and date
            const relevantPRs = prs.filter(pr => 
                pr.merged_at && 
                moment(pr.merged_at).isAfter(startDate) &&
                teamMembers.includes(pr.user.login)  // Only include PRs from team members
            );

            if (relevantPRs.length === 0) break;

            // Fetch commits for each PR
            const prsWithCommits = await Promise.all(
                relevantPRs.map(async (pr) => {
                    let allCommits = [];
                    let commitPage = 1;
                    
                    while (true) {
                        const commits = await this.fetchWithAuth(
                            `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/commits?per_page=100&page=${commitPage}`
                        );
                        
                        allCommits = allCommits.concat(commits);
                        
                        if (commits.length < 100) break;
                        commitPage++;
                    }
                    
                    return {
                        ...pr,
                        commits: allCommits.map(commit => ({
                            ...commit,
                            commitDate: commit.commit.author.date
                        }))
                    };
                })
            );

            pullRequests = pullRequests.concat(prsWithCommits);
            page++;

            // Check if we've gone past the time window
            const oldestPR = relevantPRs[relevantPRs.length - 1];
            if (moment(oldestPR.merged_at).isBefore(startDate)) {
                break;
            }
        }
       
        return pullRequests;
    }

    calculateMetrics(pullRequests) {
        if (pullRequests.length === 0) {
            return {
                prBasedMetrics: {
                    averageLeadTime: 0,
                    medianLeadTime: 0,
                    minLeadTime: {time: 0, pr: null},
                    maxLeadTime: {time: 0, pr: null},
                    totalPRs: 0
                },
                prDetails: []
            };
        }

        // Calculate PR-based metrics
        const prLeadTimes = pullRequests.map(pr => {
            const firstCommitDate = pr.commits[0]?.commitDate;
            const mergedAt = pr.merged_at;
            const leadTime = moment(mergedAt).diff(moment(firstCommitDate), 'minutes');
     
            return {
                prNumber: pr.number,
                title: pr.title,
                firstCommitDate,
                mergedAt,
                leadTime,
                commitCount: pr.commits.length,
                commits: pr.commits,
                html_url: pr.html_url
            };
        });

        const prLeadTimeValues = prLeadTimes.map(pr => pr.leadTime);

        // Find min/max PRs
        const [minPR, maxPR] = [Math.min, Math.max].map(fn => 
            prLeadTimes.find(pr => pr.leadTime === fn(...prLeadTimeValues)));

        return {
            prBasedMetrics: {
                averageLeadTime: prLeadTimeValues.reduce((a, b) => a + b, 0) / prLeadTimeValues.length,
                medianLeadTime: prLeadTimeValues.sort((a, b) => a - b)[Math.floor(prLeadTimeValues.length / 2)],
                minLeadTime: {
                    time: minPR.leadTime,
                    pr: {
                        number: minPR.prNumber,
                        url: minPR.html_url,
                        title: minPR.title
                    }
                },
                maxLeadTime: {
                    time: maxPR.leadTime,
                    pr: {
                        number: maxPR.prNumber,
                        url: maxPR.html_url,
                        title: maxPR.title
                    }
                },
                totalPRs: pullRequests.length
            },
            prDetails: prLeadTimes
        };
    }

    calculatePeriodMetrics(pullRequests, timeUnit) {
        // Group PRs by the specified time unit
        const periodPRs = pullRequests.reduce((acc, pr) => {
            const periodStart = moment(pr.merged_at).startOf(timeUnit).format('YYYY-MM-DD');
            if (!acc[periodStart]) {
                acc[periodStart] = [];
            }
            acc[periodStart].push(pr);
            return acc;
        }, {});

        // Calculate metrics for each period
        return Object.entries(periodPRs).map(([periodStart, prs]) => {
            const metrics = this.calculateMetrics(prs);
            return {
                periodStart,
                periodEnd: moment(periodStart).endOf(timeUnit).format('YYYY-MM-DD'),
                averageLeadTime: metrics.prBasedMetrics.averageLeadTime,
                medianLeadTime: metrics.prBasedMetrics.medianLeadTime,
                averageLeadTimeFormatted: this.formatDuration(metrics.prBasedMetrics.averageLeadTime),
                medianLeadTimeFormatted: this.formatDuration(metrics.prBasedMetrics.medianLeadTime),
                prCount: prs.length
            };
        }).sort((a, b) => moment(a.periodStart).diff(moment(b.periodStart)));
    }

    async calculateLeadTime(repoUrl, teamSlug, timePeriod = 'months', timeValue = 1) {
        try {
            const {owner, repo} = this.parseRepoUrl(repoUrl);
            const startDate = moment().subtract(timeValue, timePeriod).startOf(timePeriod).toISOString();

            const pullRequests = await this.getAllPullRequestsWithCommits({owner, repo, startDate, teamSlug});
            const metrics = this.calculateMetrics(pullRequests);
            const periodMetrics = this.calculatePeriodMetrics(pullRequests, timePeriod.slice(0, -1));

            return {
                repository: `${owner}/${repo}`,
                team: teamSlug,
                timePeriod: `${timeValue} ${timePeriod}`,
                prMetrics: {
                    averageLeadTime: this.formatDuration(metrics.prBasedMetrics.averageLeadTime),
                    medianLeadTime: this.formatDuration(metrics.prBasedMetrics.medianLeadTime),
                    minLeadTime: {
                        duration: this.formatDuration(metrics.prBasedMetrics.minLeadTime.time),
                        pr: metrics.prBasedMetrics.minLeadTime.pr
                    },
                    maxLeadTime: {
                        duration: this.formatDuration(metrics.prBasedMetrics.maxLeadTime.time),
                        pr: metrics.prBasedMetrics.maxLeadTime.pr
                    },
                    totalPRs: metrics.prBasedMetrics.totalPRs
                },
                periodMetrics: periodMetrics,
                details: metrics.prDetails
            };
        } catch (error) {
            throw new Error(`Failed to calculate lead time: ${error.message}`);
        }
    }
}

function minutesToDays(minutes) {
    return minutes / (24 * 60);
}

function generateSVGChart(data, labels, yLabel, containerId, timeUnit) {
    // Convert minutes to days for lead time charts
    const isLeadTimeChart = yLabel.toLowerCase().includes('lead time');
    const chartData = isLeadTimeChart ? data.map(minutesToDays) : data;
    
    // Clear previous chart
    d3.select(`#${containerId}`).html('');

    // SVG dimensions and margins
    const margin = { top: 20, right: 30, bottom: 70, left: 60 };
    const width = 800 - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    // Create SVG
    const svg = d3.select(`#${containerId}`)
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom);

    // Add group for margins
    const g = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Format x-axis labels based on time unit
    const formatPeriod = (date) => {
        switch(timeUnit) {
            case 'day':
                return moment(date).format('MMM D');
            case 'week':
                return `Week of ${moment(date).format('MMM D')}`;
            case 'month':
                return moment(date).format('MMM YYYY');
            case 'year':
                return moment(date).format('YYYY');
            default:
                return date;
        }
    };

    // Create scales
    const x = d3.scalePoint()
        .domain(labels.map(formatPeriod))
        .range([0, width]);

    const y = d3.scaleLinear()
        .domain([0, d3.max(chartData) * 1.1])
        .range([height, 0]);

    // Create line generator
    const line = d3.line()
        .x((d, i) => x(formatPeriod(labels[i])))
        .y(d => y(d));

    // Create trend line
    const trendLineData = [];
    if (chartData.length > 1) {
        const xSeries = d3.range(chartData.length);
        const ySeries = chartData;
        const xMean = d3.mean(xSeries);
        const yMean = d3.mean(ySeries);
        const slope = d3.sum(xSeries.map((x, i) => (x - xMean) * (ySeries[i] - yMean))) /
                      d3.sum(xSeries.map(x => Math.pow(x - xMean, 2)));
        const intercept = yMean - slope * xMean;

        trendLineData.push({
            x: x(formatPeriod(labels[0])),
            y: y(slope * 0 + intercept)
        });
        trendLineData.push({
            x: x(formatPeriod(labels[labels.length - 1])),
            y: y(slope * (chartData.length - 1) + intercept)
        });
    }

    // Add axes
    g.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(x))
        .selectAll('text')
        .attr('transform', 'rotate(-45)')
        .style('text-anchor', 'end');

    // Format y-axis ticks with one decimal place
    const yAxis = d3.axisLeft(y)
        .ticks(10)
        .tickFormat(d => isLeadTimeChart ? `${d.toFixed(1)}d` : d);

    g.append('g')
        .call(yAxis);

    // Add y-axis label
    const updatedYLabel = isLeadTimeChart ? yLabel.replace('(minutes)', '(days)') : yLabel;
    g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', 0 - margin.left)
        .attr('x', 0 - (height / 2))
        .attr('dy', '1em')
        .style('text-anchor', 'middle')
        .text(updatedYLabel);

    // Add the line
    g.append('path')
        .datum(chartData)
        .attr('fill', 'none')
        .attr('stroke', 'steelblue')
        .attr('stroke-width', 2)
        .attr('d', line);

    // Add trend line
    if (trendLineData.length > 0) {
        g.append('line')
            .attr('x1', trendLineData[0].x)
            .attr('y1', trendLineData[0].y)
            .attr('x2', trendLineData[1].x)
            .attr('y2', trendLineData[1].y)
            .attr('stroke', 'red')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '5,5');
    }

    // Add dots
    g.selectAll('circle')
        .data(chartData)
        .enter()
        .append('circle')
        .attr('cx', (d, i) => x(formatPeriod(labels[i])))
        .attr('cy', d => y(d))
        .attr('r', 4)
        .attr('fill', 'steelblue');

    // Add legend
    const legend = g.append('g')
        .attr('transform', `translate(${width - 100}, 0)`);

    legend.append('line')
        .attr('x1', 0)
        .attr('y1', 10)
        .attr('x2', 20)
        .attr('y2', 10)
        .attr('stroke', 'steelblue')
        .attr('stroke-width', 2);

    legend.append('text')
        .attr('x', 25)
        .attr('y', 13)
        .text('Actual');

    legend.append('line')
        .attr('x1', 0)
        .attr('y1', 30)
        .attr('x2', 20)
        .attr('y2', 30)
        .attr('stroke', 'red')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '5,5');

    legend.append('text')
        .attr('x', 25)
        .attr('y', 33)
        .text('Trend');
}

async function analyze() {
    const token = document.getElementById('token').value;
    const repoUrl = document.getElementById('repoUrl').value;
    const teamSlug = document.getElementById('teamSlug').value;
    const timeValue = document.getElementById('timeValue').value;
    const timeUnit = document.getElementById('timeUnit').value;
    const errorDiv = document.getElementById('error');
    const loadingDiv = document.getElementById('loading');
    const resultsDiv = document.getElementById('results');

    // Validate inputs
    if (!token) {
        errorDiv.textContent = 'GitHub token is required';
        return;
    }
    if (!teamSlug) {
        errorDiv.textContent = 'Team slug is required';
        return;
    }
    if (!repoUrl) {
        errorDiv.textContent = 'Repository URL is required';
        return;
    }

    errorDiv.textContent = '';
    loadingDiv.style.display = 'block';
    resultsDiv.style.display = 'none';

    try {
        const calculator = new LeadTimeCalculator(token);
        const results = await calculator.calculateLeadTime(repoUrl, teamSlug, timeUnit, parseInt(timeValue));

        // Generate charts using the time unit for proper grouping
        const timeUnitSingular = timeUnit.slice(0, -1); // Remove 's' from the end

        generateSVGChart(
            results.periodMetrics.map(period => period.averageLeadTime),
            results.periodMetrics.map(period => period.periodStart),
            'Average Lead Time (minutes)',
            'avgChart',
            timeUnitSingular
        );

        generateSVGChart(
            results.periodMetrics.map(period => period.medianLeadTime),
            results.periodMetrics.map(period => period.periodStart),
            'Median Lead Time (minutes)',
            'medianChart',
            timeUnitSingular
        );

        generateSVGChart(
            results.periodMetrics.map(period => period.prCount),
            results.periodMetrics.map(period => period.periodStart),
            'Number of PRs',
            'prChart',
            timeUnitSingular
        );

        // Show results
        resultsDiv.style.display = 'block';
    } catch (error) {
        errorDiv.textContent = error.message;
    } finally {
        loadingDiv.style.display = 'none';
    }
} 