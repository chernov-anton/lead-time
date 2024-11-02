class LeadTimeCalculator {
    constructor(token) {
        this.token = token;
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
        
        // Check for rate limiting
        const remaining = response.headers.get('x-ratelimit-remaining');
        if (remaining && parseInt(remaining) < 10) {
            await delay(1000); // Add a delay when close to rate limit
        }
        
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.statusText}`);
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

    async getAllPullRequestsWithCommits({owner, repo, startDate, teamMembers}) {
        let pullRequests = [];
        let page = 1;

        while (true) {
            const prs = await this.fetchWithAuth(
                `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`
            );

            const relevantPRs = prs.filter(pr => 
                pr.merged_at && 
                moment(pr.merged_at).isAfter(startDate) &&
                teamMembers.includes(pr.user.login)
            );

            if (relevantPRs.length === 0) break;

            // Fetch commits for all PRs in parallel
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

    calculatePeriodMetrics(pullRequests, timeUnit, timeValue) {
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
        return Object.entries(periodPRs)
            .map(([periodStart, prs]) => {
                const metrics = this.calculateMetrics(prs);
                return {
                    periodStart,
                    periodEnd: moment(periodStart).endOf(timeUnit).format('YYYY-MM-DD'),
                    averageLeadTime: metrics.prBasedMetrics.averageLeadTime,
                    medianLeadTime: metrics.prBasedMetrics.medianLeadTime,
                    averageLeadTimeFormatted: this.formatDuration(metrics.prBasedMetrics.averageLeadTime),
                    medianLeadTimeFormatted: this.formatDuration(metrics.prBasedMetrics.medianLeadTime),
                    prCount: prs.length,
                    prs: prs.map(pr => ({
                        ...pr,
                        leadTimeFormatted: this.formatDuration(
                            moment(pr.merged_at).diff(moment(pr.created_at), 'minutes')
                        ),
                        commits: pr.commits || [] // Ensure commits array exists
                    })).sort((a, b) => moment(b.merged_at).diff(moment(a.merged_at))) // Sort by merge date
                };
            })
            .sort((a, b) => moment(a.periodStart).diff(moment(b.periodStart)))
            .slice(-timeValue);
    }

    async getTeamRepos(owner, teamSlug) {
        try {
            let allRepos = [];
            let page = 1;
            
            while (true) {
                const repos = await this.fetchWithAuth(
                    `https://api.github.com/orgs/${owner}/teams/${teamSlug}/repos?per_page=100&page=${page}`
                );
                
                if (repos.length === 0) break;
                
                // Filter for repos where team has admin permissions
                const teamOwnedRepos = repos.filter(repo => 
                    repo.permissions && (repo.permissions.maintain === true)
                );
                
                allRepos = allRepos.concat(teamOwnedRepos);
                page++;
            }
            
            return allRepos.map(repo => repo.name);
        } catch (error) {
            throw new Error(`Failed to fetch team repositories: ${error.message}`);
        }
    }

    async calculateLeadTime(orgName, teamSlugs, timePeriod = 'months', timeValue = 1) {
        try {
            const startDate = moment().subtract(timeValue, timePeriod).startOf(timePeriod).toISOString();

            // Fetch team members for all teams in parallel
            const teamMembersPromises = teamSlugs.map(teamSlug => 
                this.getTeamMembers(orgName, teamSlug)
            );
            const teamMembersArrays = await Promise.all(teamMembersPromises);
            
            // Combine and deduplicate team members
            const teamMembers = [...new Set(teamMembersArrays.flat())];

            // Fetch repos for all teams in parallel
            const reposPromises = teamSlugs.map(teamSlug => 
                this.getTeamRepos(orgName, teamSlug)
            );
            const reposArrays = await Promise.all(reposPromises);
            
            // Combine and deduplicate repos
            const repos = [...new Set(reposArrays.flat())];

            // Fetch PRs from all repos in parallel
            const pullRequestsPromises = repos.map(repo => 
                this.getAllPullRequestsWithCommits({
                    owner: orgName, 
                    repo, 
                    startDate, 
                    teamMembers
                }).catch(error => {
                    console.warn(`Failed to fetch PRs for ${orgName}/${repo}: ${error.message}`);
                    return [];
                })
            );

            const pullRequestsArrays = await Promise.all(pullRequestsPromises);
            const allPullRequests = pullRequestsArrays.flat();

            const metrics = this.calculateMetrics(allPullRequests);
            const periodMetrics = this.calculatePeriodMetrics(allPullRequests, timePeriod.slice(0, -1), timeValue);

            return {
                organization: orgName,
                team: teamSlugs,
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
                    totalPRs: metrics.prBasedMetrics.totalPRs,
                    repoCount: repos.length
                },
                periodMetrics: periodMetrics,
                details: metrics.prDetails
            };
        } catch (error) {
            console.error('Error calculating lead time:', error);
            throw error;
        }
    }

    async getOrganizations() {
        try {
            const response = await this.fetchWithAuth('https://api.github.com/user/orgs');
            return response.map(org => ({
                name: org.login,
                displayName: org.name || org.login
            }));
        } catch (error) {
            throw new Error(`Failed to fetch organizations: ${error.message}`);
        }
    }

    async getTeams(orgName) {
        try {
            const response = await this.fetchWithAuth(
                `https://api.github.com/orgs/${orgName}/teams`
            );
            return response.map(team => ({
                slug: team.slug,
                name: team.name
            }));
        } catch (error) {
            throw new Error(`Failed to fetch teams: ${error.message}`);
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

function createCustomSelect(teams) {
    const teamSelect = document.getElementById('teamSlug');
    const customSelect = document.createElement('div');
    customSelect.className = 'custom-select';
    
    // Create search input
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search teams...';
    searchInput.className = 'team-search';
    
    // Create options container
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'options-container';
    
    // Create "Select All" option
    const selectAllDiv = document.createElement('div');
    selectAllDiv.className = 'select-option select-all';
    const selectAllCheckbox = document.createElement('input');
    selectAllCheckbox.type = 'checkbox';
    selectAllCheckbox.id = 'select-all';
    const selectAllLabel = document.createElement('label');
    selectAllLabel.htmlFor = 'select-all';
    selectAllLabel.textContent = 'Select All';
    selectAllDiv.appendChild(selectAllCheckbox);
    selectAllDiv.appendChild(selectAllLabel);
    
    // Add teams
    const options = teams.map(team => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'select-option';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = team.slug;
        checkbox.id = `team-${team.slug}`;
        
        const label = document.createElement('label');
        label.htmlFor = `team-${team.slug}`;
        label.textContent = team.name;
        
        optionDiv.appendChild(checkbox);
        optionDiv.appendChild(label);
        return optionDiv;
    });
    
    // Add event listeners
    searchInput.addEventListener('input', (e) => {
        const searchText = e.target.value.toLowerCase();
        options.forEach(option => {
            const label = option.querySelector('label').textContent.toLowerCase();
            option.style.display = label.includes(searchText) ? 'block' : 'none';
        });
    });
    
    selectAllCheckbox.addEventListener('change', (e) => {
        const visibleOptions = options.filter(opt => opt.style.display !== 'none');
        visibleOptions.forEach(option => {
            option.querySelector('input').checked = e.target.checked;
        });
        updateSelectedCount();
    });
    
    // Selected count display
    const selectedCount = document.createElement('div');
    selectedCount.className = 'selected-count';
    
    function updateSelectedCount() {
        const checkedCount = options.filter(opt => opt.querySelector('input').checked).length;
        selectedCount.textContent = `${checkedCount} team${checkedCount !== 1 ? 's' : ''} selected`;
    }
    
    options.forEach(option => {
        option.querySelector('input').addEventListener('change', updateSelectedCount);
    });
    
    // Assemble the custom select
    optionsContainer.appendChild(selectAllDiv);
    options.forEach(option => optionsContainer.appendChild(option));
    customSelect.appendChild(searchInput);
    customSelect.appendChild(optionsContainer);
    customSelect.appendChild(selectedCount);
    
    // Replace the original select with custom select
    teamSelect.parentNode.replaceChild(customSelect, teamSelect);
    
    // Update the analyze function to work with custom select
    window.getSelectedTeams = () => {
        return options
            .filter(option => option.querySelector('input').checked)
            .map(option => option.querySelector('input').value);
    };
    
    updateSelectedCount();
}

async function initializeSelects() {
    const token = document.getElementById('token').value;
    if (!token) return;

    const calculator = new LeadTimeCalculator(token);
    const errorDiv = document.getElementById('error');
    const orgSelect = document.getElementById('orgName');

    try {
        // Fetch and populate organizations
        const organizations = await calculator.getOrganizations();
        orgSelect.innerHTML = `
            <option value="">Select an organization</option>
            ${organizations.map(org => 
                `<option value="${org.name}">${org.displayName}</option>`
            ).join('')}
        `;

        // Add change handler for organization select
        orgSelect.onchange = async () => {
            const selectedOrg = orgSelect.value;
            if (!selectedOrg) {
                document.querySelector('.custom-select')?.remove();
                return;
            }

            try {
                const teams = await calculator.getTeams(selectedOrg);
                createCustomSelect(teams);
            } catch (error) {
                errorDiv.textContent = `Error loading teams: ${error.message}`;
            }
        };

    } catch (error) {
        errorDiv.textContent = `Error loading organizations: ${error.message}`;
    }
}

function generatePRDetailsTable(periodMetrics) {
    let html = '<div class="pr-details">';
    
    periodMetrics.forEach(period => {
        // Find the PR with the longest lead time in this period
        const slowestPR = period.prs.reduce((max, pr) => 
            moment(pr.merged_at).diff(moment(pr.created_at), 'minutes') > 
            moment(max.merged_at).diff(moment(max.created_at), 'minutes') ? pr : max
        , period.prs[0]);
        
        html += `
            <div class="period-section">
                <h3>Period: ${period.periodStart} to ${period.periodEnd}</h3>
                <div class="period-summary">
                    <p>Average Lead Time: ${period.averageLeadTimeFormatted}</p>
                    <p>Median Lead Time: ${period.medianLeadTimeFormatted}</p>
                    <p>Total PRs: ${period.prCount}</p>
                </div>
                <table class="pr-table">
                    <thead>
                        <tr>
                            <th>PR</th>
                            <th>Author</th>
                            <th>Lead Time</th>
                            <th>Commits</th>
                            <th>Created</th>
                            <th>Merged</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${period.prs.map(pr => `
                            <tr class="${pr.number === slowestPR.number ? 'slowest-pr' : ''}">
                                <td><a href="${pr.html_url}" target="_blank">#${pr.number} ${escapeHtml(pr.title)}</a></td>
                                <td>${pr.user.login}</td>
                                <td>${pr.leadTimeFormatted}</td>
                                <td>${pr.commits.length}</td>
                                <td>${moment(pr.created_at).format('YYYY-MM-DD HH:mm')}</td>
                                <td>${moment(pr.merged_at).format('YYYY-MM-DD HH:mm')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    });
    
    html += '</div>';
    return html;
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function analyze() {
    const token = document.getElementById('token').value;
    const orgName = document.getElementById('orgName').value;
    const selectedTeams = window.getSelectedTeams();
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
    if (selectedTeams.length === 0) {
        errorDiv.textContent = 'At least one team must be selected';
        return;
    }
    if (!orgName) {
        errorDiv.textContent = 'Organization name is required';
        return;
    }

    errorDiv.textContent = '';
    loadingDiv.style.display = 'block';
    
    // Clear previous results
    resultsDiv.style.display = 'none';
    resultsDiv.innerHTML = `
        <div class="chart">
            <h2>Average Lead Time</h2>
            <div id="avgChart"></div>
        </div>
        
        <div class="chart">
            <h2>Median Lead Time</h2>
            <div id="medianChart"></div>
        </div>
        
        <div class="chart">
            <h2>PR Count</h2>
            <div id="prChart"></div>
        </div>
    `;

    try {
        const calculator = new LeadTimeCalculator(token);
        const results = await calculator.calculateLeadTime(orgName, selectedTeams, timeUnit, parseInt(timeValue));

        // Generate charts
        generateSVGChart(
            results.periodMetrics.map(period => period.averageLeadTime),
            results.periodMetrics.map(period => period.periodStart),
            'Average Lead Time (minutes)',
            'avgChart',
            timeUnit.slice(0, -1)
        );

        generateSVGChart(
            results.periodMetrics.map(period => period.medianLeadTime),
            results.periodMetrics.map(period => period.periodStart),
            'Median Lead Time (minutes)',
            'medianChart',
            timeUnit.slice(0, -1)
        );

        generateSVGChart(
            results.periodMetrics.map(period => period.prCount),
            results.periodMetrics.map(period => period.periodStart),
            'Number of PRs',
            'prChart',
            timeUnit.slice(0, -1)
        );

        // Add PR details table
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'details-section';
        detailsDiv.innerHTML = `
            <h2>Detailed PR Analysis</h2>
            ${generatePRDetailsTable(results.periodMetrics)}
        `;
        resultsDiv.appendChild(detailsDiv);

        resultsDiv.style.display = 'block';
    } catch (error) {
        errorDiv.textContent = error.message;
    } finally {
        loadingDiv.style.display = 'none';
    }
} 