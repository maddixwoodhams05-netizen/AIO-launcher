# tests: automatic checks

Run with `npm test` or by double-clicking `Run tests.bat`.

- `app.test.js` opens the real launcher with pretend games and clicks through it
- `logic.test.js` checks game finding (folders, Steam and the other stores), Steam art matching, storage safety rules, playtime maths, update checks and that the changelog has the current version
- `helpers.js` sets up the pretend games, pretend stores and a throwaway library, so your own library is never touched
