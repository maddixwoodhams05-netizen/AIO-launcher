# tests: automatic checks

Run with `npm test` or by double-clicking `Run tests.bat`.

- `app.test.js` opens the real launcher with pretend games and clicks through it
- `logic.test.js` checks game finding, Steam art matching, storage safety rules and playtime maths on their own
- `helpers.js` sets up the pretend games and a throwaway library, so your own library is never touched
