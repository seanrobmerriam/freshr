export const handler = () => {
  const json = {
    MY_ENV: process.env.MY_ENV,
    VITE_MY_ENV: process.env.VITE_MY_ENV,
    MY_LOCAL_ENV: process.env.MY_LOCAL_ENV,
    VITE_MY_LOCAL_ENV: process.env.VITE_MY_LOCAL_ENV,
  };

  return Response.json(json);
};
