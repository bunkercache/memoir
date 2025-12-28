# Changelog

## [0.3.0](https://github.com/bunkercache/opencode-memoir/compare/v0.2.3...v0.3.0) (2025-12-28)


### Features

* improve memoir_history with session scoping and browsing mode ([#35](https://github.com/bunkercache/opencode-memoir/issues/35)) ([cbf69cc](https://github.com/bunkercache/opencode-memoir/commit/cbf69cc11a36f66d5e76b226180ef2a535b9f37e))


### Bug Fixes

* include SQLite WAL mode files (-shm, -wal) in gitignore ([#33](https://github.com/bunkercache/opencode-memoir/issues/33)) ([7bb8643](https://github.com/bunkercache/opencode-memoir/commit/7bb86433a37d72379f7836fe2ef5f19663181ba5))

## [0.2.3](https://github.com/bunkercache/opencode-memoir/compare/v0.2.2...v0.2.3) (2025-12-28)


### Bug Fixes

* remove class exports that break OpenCode plugin loader ([#31](https://github.com/bunkercache/opencode-memoir/issues/31)) ([4637fae](https://github.com/bunkercache/opencode-memoir/commit/4637fae92f7c95f1233247a9cc2cfaf866c4fd12))

## [0.2.2](https://github.com/bunkercache/opencode-memoir/compare/v0.2.1...v0.2.2) (2025-12-28)


### Bug Fixes

* add main and module fields for better module resolution ([#29](https://github.com/bunkercache/opencode-memoir/issues/29)) ([4fb56df](https://github.com/bunkercache/opencode-memoir/commit/4fb56df8c73ea883f572e7ef0179565758189bb6))

## [0.2.1](https://github.com/bunkercache/opencode-memoir/compare/v0.2.0...v0.2.1) (2025-12-28)


### Bug Fixes

* correct repository name in release workflow and docs URLs ([#27](https://github.com/bunkercache/opencode-memoir/issues/27)) ([b87e466](https://github.com/bunkercache/opencode-memoir/commit/b87e466d61b2524f53fde47cb2e22d351759d0d3))
* skip prereleases in docs workflow and update base URL ([#26](https://github.com/bunkercache/opencode-memoir/issues/26)) ([714babd](https://github.com/bunkercache/opencode-memoir/commit/714babd945ef780086c3e0f87bb2d8b752357a62))


### Miscellaneous

* rename package to @bunkercache/opencode-memoir ([#25](https://github.com/bunkercache/opencode-memoir/issues/25)) ([8e21b00](https://github.com/bunkercache/opencode-memoir/commit/8e21b003930a1bbd21448fab92629f623934df80))

## [0.2.0](https://github.com/bunkercache/opencode-memoir/compare/v0.1.0...v0.2.0) (2025-12-28)


### Features

* add logging service and fix tool call tracking ([#1](https://github.com/bunkercache/opencode-memoir/issues/1)) ([fd22594](https://github.com/bunkercache/opencode-memoir/commit/fd2259400e1b9b17f5700d4fe533b373a524835c))


### Bug Fixes

* add --repo flag to gh commands and run setup before build ([#14](https://github.com/bunkercache/opencode-memoir/issues/14)) ([eb54116](https://github.com/bunkercache/opencode-memoir/commit/eb54116724ced732ca2d3d337a49bd59bb16b3fe))
* add contents:write permission for repository-dispatch ([#13](https://github.com/bunkercache/opencode-memoir/issues/13)) ([be2b3ab](https://github.com/bunkercache/opencode-memoir/commit/be2b3aba274cf62d016cfcec05efc617c39793f0))
* add license field and include LICENSE file in package ([#17](https://github.com/bunkercache/opencode-memoir/issues/17)) ([44b028e](https://github.com/bunkercache/opencode-memoir/commit/44b028e5463dcaaa0889ad85148ba51025190f7d))
* create GitHub prerelease for next versions with changelog ([#19](https://github.com/bunkercache/opencode-memoir/issues/19)) ([50b6948](https://github.com/bunkercache/opencode-memoir/commit/50b6948dbf135823f3332f937f2e71bfadd88dde))
* extract changelog between --- dividers for prerelease notes ([#22](https://github.com/bunkercache/opencode-memoir/issues/22)) ([958e701](https://github.com/bunkercache/opencode-memoir/commit/958e701408f28a27b2ca364def06a3820879347f))
* pass PR head ref to publish workflow for correct version ([#16](https://github.com/bunkercache/opencode-memoir/issues/16)) ([5b3335d](https://github.com/bunkercache/opencode-memoir/commit/5b3335d2d2916e8782935f126174dac19e2a711b))
* remove beep boop header and strip footer from prerelease notes ([#20](https://github.com/bunkercache/opencode-memoir/issues/20)) ([91d7101](https://github.com/bunkercache/opencode-memoir/commit/91d710109300aaa966c77bd375b7b479a341e602))
* remove types export and @types/node dependency ([#18](https://github.com/bunkercache/opencode-memoir/issues/18)) ([44fcaac](https://github.com/bunkercache/opencode-memoir/commit/44fcaacc8fd4ce298a58b3375a799335df198d09))
* replace base version with prerelease version in release notes ([#21](https://github.com/bunkercache/opencode-memoir/issues/21)) ([2329011](https://github.com/bunkercache/opencode-memoir/commit/23290110aa9237ad1c242d30b3b0be7a60209318))
* update author email to match GitHub noreply format ([#24](https://github.com/bunkercache/opencode-memoir/issues/24)) ([4869414](https://github.com/bunkercache/opencode-memoir/commit/48694149863e953b4ac857696565d559ef774184))
* update release-next workflow to match release-please PR title format ([#12](https://github.com/bunkercache/opencode-memoir/issues/12)) ([8f6bba8](https://github.com/bunkercache/opencode-memoir/commit/8f6bba8fbac62bf6900b9172e21d30b295607799))
* use config-file and manifest-file for release-please ([#11](https://github.com/bunkercache/opencode-memoir/issues/11)) ([cbf4682](https://github.com/bunkercache/opencode-memoir/commit/cbf46827cc053692c8a0e70841bd2df0827353dc))
* use github-hosted runner for npm provenance support ([#15](https://github.com/bunkercache/opencode-memoir/issues/15)) ([79e85c3](https://github.com/bunkercache/opencode-memoir/commit/79e85c31611011dd0000e07cb331d531889dd839))


### Miscellaneous

* add changelog sections to include chore/docs/perf commits ([#10](https://github.com/bunkercache/opencode-memoir/issues/10)) ([81eb226](https://github.com/bunkercache/opencode-memoir/commit/81eb226e8983bf99d2864de0e94b78c6ff99b2d1))
* Configure Renovate ([#2](https://github.com/bunkercache/opencode-memoir/issues/2)) ([94e342e](https://github.com/bunkercache/opencode-memoir/commit/94e342e363bb5ad1d6b86cbc57a97104a8a69b87))
* **deps:** update dependency @types/node to v25 ([#8](https://github.com/bunkercache/opencode-memoir/issues/8)) ([7cc7379](https://github.com/bunkercache/opencode-memoir/commit/7cc73790065c1c747c36164f312af3844497911b))
* **deps:** update dependency usage to v2.10.0 ([#5](https://github.com/bunkercache/opencode-memoir/issues/5)) ([404a711](https://github.com/bunkercache/opencode-memoir/commit/404a7112f2c05b4c3a5852f2b5795881c0e4ddcf))
* **deps:** update dependency vitest to v4 ([#9](https://github.com/bunkercache/opencode-memoir/issues/9)) ([43e3e9e](https://github.com/bunkercache/opencode-memoir/commit/43e3e9ecc6958d1e80696ed86a11088311703a40))
* **deps:** update typescript-eslint monorepo to v8.50.1 ([#6](https://github.com/bunkercache/opencode-memoir/issues/6)) ([63b6e13](https://github.com/bunkercache/opencode-memoir/commit/63b6e13203ab7d40ca8f4c9084bbebc22bd45007))
* initialize bunkercache-memoir from opencode plugin template ([3e08cfc](https://github.com/bunkercache/opencode-memoir/commit/3e08cfc93dcca7386b04b613d21124e7aa41cf0b))
* pin all GitHub Actions to latest versions with full SHAs ([#3](https://github.com/bunkercache/opencode-memoir/issues/3)) ([b66618c](https://github.com/bunkercache/opencode-memoir/commit/b66618c8d5e257907e9ee174ada6fc2777897430))

## Changelog

All notable changes to this project will be documented here by Release Please.
