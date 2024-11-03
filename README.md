# [GitHub Lead Time Calculator](https://chernov-anton.github.io/lead-time/)

A browser-based tool to calculate and visualize lead time metrics for GitHub team pull requests. Built with AI assistance (Claude).

## Features

- Calculate lead time metrics for GitHub teams
- Multiple team selection with search functionality
- Flexible date range selection
- Customizable time unit grouping (daily, weekly, monthly)
- Interactive SVG charts showing:
  - Average lead time
  - Median lead time
  - Number of PRs
- Trend line analysis
- Detailed PR breakdown by period
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
2. Select your organization from the dropdown
3. Select one or more teams using the searchable multi-select
4. Choose your date range using the date pickers
5. Select your preferred time unit (daily, weekly, or monthly)
6. Click "Analyze"

The tool will generate:
- Three interactive charts:
  - Average lead time over time
  - Median lead time over time
  - Number of PRs over time
- Detailed breakdown of PRs by period
- Trend analysis for each metric

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

This project was developed with AI assistance using Claude (Anthropic). The AI helped with:
- Initial code structure
- D3.js chart implementation
- GitHub API integration
- Error handling
- Documentation
- UI/UX improvements

## Limitations

- Only analyzes merged PRs
- Requires team member to have created the PR (doesn't track reviewers)
- Token must be manually entered each time
- No data persistence
- Limited to GitHub API rate limits

## Future Improvements

- Add data export functionality
- Include PR review time metrics
- Implement data caching
- Add team member contribution breakdown

## License

MIT

## Acknowledgments

- Built with assistance from Claude AI (Anthropic)
- Uses GitHub REST API
- Visualization powered by D3.js