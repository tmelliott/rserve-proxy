export function Login() {
  return (
    <div>
      <h1>Login</h1>
      <form>
        <div>
          <label htmlFor="username">Username</label>
          <input id="username" name="username" type="text" required />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required />
        </div>
        <button type="submit">Log in</button>
      </form>
    </div>
  );
}
