# GitHub Lead Time Calculator

A browser-based tool to calculate and visualize lead time metrics for GitHub team pull requests. Built with AI assistance (Claude) in approximately 1 hour.

## Features

- Calculate lead time metrics for specific GitHub teams
- Filter by time period (days, weeks, months, years)
- Interactive SVG charts showing:
  - Average lead time
  - Median lead time
  - Number of PRs
- Trend line analysis
- No backend required - runs entirely in browser

## Setup

1. Clone this repository
2. Serve the files using any static file server. For example:
   ```bash
   npx http-server
   ```
3. Open `http://localhost:8080` in your browser

## Usage

### Generate a GitHub Token

1. Go to [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a name (e.g., "Lead Time Calculator")
4. Select these scopes:
   - `repo` (for repository access)
   - `read:org` (for team membership access)
5. Click "Generate token"
6. Copy the token (you'll need it later)

### Calculate Lead Time

1. Enter your GitHub Personal Access Token
2. Provide the repository URL (e.g., `https://github.com/owner/repo`)
3. Enter your team slug (found in the team's URL, e.g., if the team URL is `https://github.com/orgs/owner/teams/my-team`, the slug is `my-team`)
4. Select the time period and value (e.g., 3 months)
5. Click "Analyze"

The tool will generate three charts:
- Average lead time over time
- Median lead time over time
- Number of PRs over time

Each chart includes a trend line to show the overall direction of the metric.

## Metrics Explanation

- **Lead Time**: The time between the first commit in a PR and when the PR is merged
- **Average Lead Time**: Mean lead time for all PRs in a period
- **Median Lead Time**: Middle value of lead times in a period (less affected by outliers)
- **PR Count**: Number of merged PRs in a period

## Security Notes

- The token is only stored in memory during analysis
- All API calls are made directly from your browser to GitHub
- Use tokens with minimal necessary permissions
- Regularly rotate your tokens
- Never commit tokens to source control

## Dependencies

- D3.js for charting
- Moment.js for date handling

## Development

This project was developed with AI assistance using Claude (Anthropic) in approximately one hour. The AI helped with:
- Initial code structure
- D3.js chart implementation
- GitHub API integration
- Error handling
- Documentation

## Limitations

- Only analyzes merged PRs
- Requires team member to have created the PR (doesn't track reviewers)
- Token must be manually entered each time
- No data persistence
- Limited to GitHub API rate limits

## Future Improvements

- Add data export functionality
- Include PR review time metrics
- Add more detailed PR statistics
- Implement data caching
- Add team member contribution breakdown
- Support for multiple repositories comparison

## License

MIT

## Acknowledgments

- Built with assistance from Claude AI (Anthropic)
- Uses GitHub REST API
- Visualization powered by D3.js 