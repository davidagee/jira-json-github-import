import Octokit from "@octokit/rest";
import chalk from "chalk";
export default class GithubDataLoader {
  private readonly options: { owner: string; repo: string; state: string };
  private readonly kit: Octokit;
  constructor({ auth, owner, repo, state }) {
    this.options = {
      owner,
      repo,
      state
    };
    this.kit = new Octokit({
      auth
    });
  }

  async fetchIssues() {
    console.log(`\tRetrieving Github issues...`);
    return await this.kit
      .paginate(
        this.kit.issues.listForRepo.endpoint.merge({
          ...this.options,
          per_page: 100
        })
      )
      .then(data => {
        console.log(
          `\tRetrieved ${chalk.blueBright(
            data.length.toString()
          )} issues from Github`
        );
        return data;
      });
  }

  async fetchComments() {
    console.log(`\tRetrieving Github comments...`);
    return await this.kit
      .paginate(
        this.kit.issues.listCommentsForRepo.endpoint.merge({
          ...this.options,
          per_page: 100
        })
      )
      .then(data => {
        console.log(
          `\tRetrieved ${chalk.blueBright(
            data.length.toString()
          )} comments from Github`
        );
        return data;
      });
  }
}
