import { markdownToAtlassianWikiMarkup } from '@kenchan0130/markdown-to-atlassian-wiki-markup';
import chalk from 'chalk';
import fs from 'fs';
import yaml from 'yaml';

import GithubDataLoader from './GithubDataLoader';

const LOG_LEVEL = 'debug';
const CONFIG_YAML = 'config.yaml';
const RAW_GITHUB_FILENAME = 'github.json';
const OUTPUT_FILENAME = 'output.json';

const config = yaml.parse(fs.readFileSync(CONFIG_YAML, 'utf8'));
const { auth, owner, repo, state } = config.github;
const { projectKey } = config.jira;
const {
  priorityMap,
  defaultPriority = 'Medium',
  issueTypeMap,
  defaultIssueType = 'Story',
} = config;

const userMap = config.userMap;

export interface GithubComment {
  body: string;
  user: GithubUser;
  created_at: string;
  issue_url: string;
}
export interface GithubIssue {
  labels: GithubLabel[];
  number: number;
  state: 'open' | 'closed';
  user: GithubUser;
  assignee: GithubUser;
  created_at: string;
  updated_at: string;
  title: string;
  body: string;
  milestone: GithubMilestone;
}
export interface GithubLabel {
  name: string;
}
export interface GithubMilestone {
  title: string;
}
export interface GithubUser {
  login: string;
}
export interface JiraComment {
  body: string;
  author: string;
  created: string;
}
export interface JiraCustomField {
  fieldName: string;
  fieldType: string;
  value: string[];
}
export interface JiraIssue {
  key: string;
  status: string;
  resolution: string | null;
  reporter: string;
  assignee?: string;
  fixedVersions: string[];
  created: string;
  updated: string;
  summary: string;
  description: string;
  issueType: string;
  priority: string;
  labels: string[];
  customFieldValues: JiraCustomField[];
  comments: JiraComment[];
}

export interface JiraProject {
  name: string;
  externalName: string;
  key: string;
  issues: JiraIssue[];
  versions: any;
}

/**
 * Writes a serializable POJO to disk as JSON
 * @param data - The data to write to disk
 * @param filename - The name of the file to write
 */
const writeJSON = (data: object, filename: string): object => {
  if (LOG_LEVEL === 'debug') {
    console.log(`Writing ${chalk.yellow(filename)}...\n`);
  }
  fs.writeFileSync(filename, JSON.stringify(data, null, 2), 'utf8');
  return data;
};

/**
 * Attempts to convert github-flavored markdown to Atlassian wiki format.
 * If the conversion fails, it returns the original markdown.
 * @param md - Source markdown
 */
const mdToWiki = (md: string): string => {
  try {
    return markdownToAtlassianWikiMarkup(md);
  } catch (e) {
    console.log(
      `Failed to convert the following markdown to Wiki format, falling back to raw markdown:\n${JSON.stringify(
        md
      )}`
    );
    return md;
  }
};

/**
 * Transforms an array of Github comment objects to JIRA format.
 * @param githubComments
 */
const mapGithubCommentsToJiraComments = (
  githubComments: GithubComment[]
): JiraComment[] => {
  console.log(
    `\tMapping ${chalk.blueBright(
      githubComments.length.toString()
    )} comments...`
  );
  return githubComments.map(comment => ({
    body: mdToWiki(comment.body),
    author: comment.user.login,
    created: mapDate(comment.created_at),
  }));
};

const mapLabelToValue = (
  githubIssue: GithubIssue,
  map: object,
  defaultValue: string
): string => {
  if (!map || !Object.values(map).length) {
    return defaultValue;
  }
  return Object.keys(map).reduce((currentValue, githubLabel) => {
    const githubLabelNames = githubIssue.labels.map(l => l.name);
    if (githubLabelNames.includes(githubLabel)) {
      // TODO Not too happy about this side effect.
      githubIssue.labels = githubIssue.labels.filter(
        label => label.name !== githubLabel
      );
      return map[githubLabel];
    }
    return currentValue;
  }, defaultValue);
};

/**
 * Transforms Github labels to JIRA custom fields.
 * @param githubLabels
 */
const mapLabelsToCustomFields = (
  githubLabels: GithubLabel[]
): JiraCustomField[] => {
  const { customFields } = config;

  if (!customFields.length) {
    return [];
  }

  return customFields.map(({ fieldName, fieldType, map, prefixes }) => ({
    fieldName,
    fieldType,
    value: map
      ? githubLabels
          .map(l => l.name)
          .reduce(
            (acc, githubLabel) =>
              map[githubLabel] ? [...acc, map[githubLabel]] : acc,
            <string[]>[]
          )
      : githubLabels
          .map(l => l.name)
          .filter(label => prefixes.some(prefix => label.startsWith(prefix)))
          .reduce(
            (acc, label) => [
              ...acc,
              prefixes.reduce(
                (result, prefix) => result.replace(prefix, ''),
                label
              ),
            ],
            <string[]>[]
          )
          .map(label => label.split(' ').join('_')),
  }));
};

/**
 * Converts UCT 'Z' shorthand date format returned by Github to explicit '+00:00' for JIRA
 * @param githubDate
 */
const mapDate = (githubDate: string): string =>
  `${githubDate.slice(0, -1)}+00:00`;

/**
 * Transforms a Github issue and any associated comments to a JIRA issue with embedded comments.
 * @param issue
 * @param issueComments
 */
const mapGithubIssueToJiraIssue = (
  issue: GithubIssue,
  issueComments: GithubComment[]
): JiraIssue => {
  console.log(
    `\tTransforming Github issue #${chalk.blueBright(
      issue.number.toString()
    )} to JIRA format`
  );

  return {
    key: `${projectKey}-${issue.number}`,
    status: 'To Do',
    resolution: issue.state === 'closed' ? 'Fixed' : null,
    reporter: userMap[issue.user.login],
    assignee: issue.assignee
      ? userMap[issue.assignee.login] || issue.assignee.login
      : null,
    fixedVersions: issue.milestone ? [issue.milestone.title] : [],
    created: mapDate(issue.created_at),
    updated: mapDate(issue.updated_at),
    summary: issue.title,
    description: mdToWiki(issue.body),
    issueType: mapLabelToValue(issue, issueTypeMap, defaultIssueType),
    priority: mapLabelToValue(issue, priorityMap, defaultPriority),
    labels: issue.labels.map(label => label.name),
    customFieldValues: mapLabelsToCustomFields(issue.labels),
    comments: issueComments
      ? mapGithubCommentsToJiraComments(issueComments)
      : [],
  };
};

/**
 * Maps a collection of Github issues and comments to JIRA issues with embedded comments
 *
 * @param githubIssues - An array of Github issues
 * @param commentsDictionary - A dictionary of Github comments keyed by issue number.
 */
const mapGithubIssuesToJiraIssues = (githubIssues, commentsDictionary) => {
  console.log(
    `Mapping ${chalk.yellow(githubIssues.length)} Github issues to JIRA format`
  );
  return githubIssues.map(issue =>
    mapGithubIssueToJiraIssue(issue, commentsDictionary[issue.number])
  );
};

/**
 * Create a dictionary of Github comments keyed by issue number.
 * @param githubComments - An array of Github comments
 */
const createCommentDictionary = (githubComments: GithubComment[]): object =>
  githubComments.reduce((dictionary, comment) => {
    const issueNumber = <string>comment.issue_url.split('/').pop();
    dictionary[issueNumber] = dictionary[issueNumber]
      ? [...dictionary[issueNumber], comment]
      : [comment];
    return dictionary;
  }, {});

const mapGithubDataToJiraData = githubData => {
  const { githubIssues, githubComments } = githubData;
  const commentDictionary = createCommentDictionary(githubComments);
  const issues = mapGithubIssuesToJiraIssues(githubIssues, commentDictionary);

  const project: JiraProject = {
    name: repo,
    externalName: repo,
    key: config.jira.projectKey,
    issues,
    versions: [...new Set(issues.flatMap(issue => issue.fixedVersions))],
  };

  return {
    projects: [project],
  };
};

console.log(
  `Fetching Github data from ${chalk.yellow(owner)}/${chalk.yellow(repo)}`
);

const issueLoader = new GithubDataLoader({
  auth,
  owner,
  repo,
  state,
});

const dataSets = [
  issueLoader.fetchIssues(),
  config.github.includeComments
    ? issueLoader.fetchComments()
    : Promise.resolve(null),
];

Promise.all(dataSets)
  .then(([githubIssues, githubComments]) => {
    return {
      githubIssues,
      githubComments,
    };
  })
  .then(objData =>
    LOG_LEVEL === 'debug' ? writeJSON(objData, RAW_GITHUB_FILENAME) : objData
  )
  .then(mapGithubDataToJiraData)
  .then(jiraData => writeJSON(jiraData, OUTPUT_FILENAME))
  .catch(e => {
    console.log(
      `${chalk.redBright('Failed to convert issues:')} \n${JSON.stringify(
        e,
        null,
        2
      )}`
    );
    throw e;
  });
