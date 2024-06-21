export async function mainModule() {
  console.log(`Hello from mainModule`);
}

export function myUntestedFunction() {
  console.log("hello");
}

mainModule()
  .then(() => {
    console.log("mainModule loaded");
  })
  .catch((error) => {
    console.error(error);
  });
