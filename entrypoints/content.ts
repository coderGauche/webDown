export default defineContentScript({
  registration: 'runtime',
  main() {
    console.info('[SiteCapsule] Content script initialized.');
  },
});
