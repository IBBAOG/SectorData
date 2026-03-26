"""
Itaú BBA Dashboard — Dash entry point.

Run:  python app.py
"""
import os
import secrets
from dotenv import load_dotenv

import dash
import dash_bootstrap_components as dbc
from dash import dcc, html, Input, Output, State, callback, no_update
from flask import session
from flask_caching import Cache

# ── Load env ──────────────────────────────────────────────────────────────────
load_dotenv()

# ── App init ──────────────────────────────────────────────────────────────────
app = dash.Dash(
    __name__,
    use_pages=True,
    external_stylesheets=[dbc.themes.BOOTSTRAP],
    suppress_callback_exceptions=True,
    title="Itaú BBA | Dashboard",
    update_title=None,
)

server = app.server
server.secret_key = os.getenv("SECRET_KEY") or secrets.token_hex(32)

# ── Flask-Caching ─────────────────────────────────────────────────────────────
cache = Cache(config={"CACHE_TYPE": "SimpleCache"})
cache.init_app(server)

# Inject cache into database module
from components import database as _db
_db.set_cache(cache)

# ── Constants ──────────────────────────────────────────────────────────────────
LOGO_URL   = "https://raw.githubusercontent.com/IBBAOG/SectorData/main/assets/logo.webp"
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")


# ─────────────────────────────────────────────────────────────────────────────
# Login layout
# ─────────────────────────────────────────────────────────────────────────────
def login_layout():
    return html.Div(
        id="login-container",
        children=html.Div(
            id="login-card",
            children=[
                html.Div(
                    html.Img(src=LOGO_URL, style={"width": "160px", "marginBottom": "24px"}),
                    style={"textAlign": "center"},
                ),
                html.H5(
                    "Sign in to your account",
                    style={"fontFamily": "Arial", "fontWeight": "600", "color": "#1a1a1a", "marginBottom": "4px"},
                ),
                html.P(
                    "Enter your credentials to continue.",
                    style={"fontFamily": "Arial", "fontSize": "13px", "color": "#888", "marginBottom": "20px"},
                ),
                html.Hr(),
                dbc.Label("Email", html_for="input-email"),
                dbc.Input(id="input-email", type="email", placeholder="name@email.com",
                          className="mb-3"),
                dbc.Label("Password", html_for="input-password"),
                dbc.Input(id="input-password", type="password", placeholder="••••••••",
                          className="mb-4"),
                dbc.Button("Continue →", id="btn-login", n_clicks=0, className="mb-2"),
                dbc.Alert(id="login-error", is_open=False, color="danger",
                          style={"fontSize": "13px", "marginTop": "8px"}),
            ],
        ),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Main authenticated layout
# ─────────────────────────────────────────────────────────────────────────────
def main_layout():
    nav_links = [
        dbc.NavItem(dbc.NavLink("Sales",        href="/",            active="exact",
                                style={"fontFamily": "Arial", "fontSize": "14px"})),
        dbc.NavItem(dbc.NavLink("Market Share", href="/market-share", active="exact",
                                style={"fontFamily": "Arial", "fontSize": "14px"})),
    ]

    navbar = dbc.Navbar(
        dbc.Container([
            dbc.NavbarBrand(
                html.Img(src=LOGO_URL, style={"height": "32px"}),
                href="/",
            ),
            dbc.Nav(nav_links, navbar=True, className="me-auto ms-3"),
            dbc.Nav([
                dbc.NavItem(
                    dbc.Button("Sign out", id="btn-logout", size="sm", outline=True,
                               color="secondary",
                               style={"fontFamily": "Arial", "fontSize": "12px"}),
                ),
            ], navbar=True),
        ], fluid=True),
        id="main-navbar",
        dark=False,
        color="white",
        sticky="top",
    )

    return html.Div([
        navbar,
        dash.page_container,
        dbc.Toast(
            "Filters applied!",
            id="toast-filters",
            icon="success",
            duration=2500,
            is_open=False,
        ),
    ])


# ─────────────────────────────────────────────────────────────────────────────
# Root layout — checks session on every request
# ─────────────────────────────────────────────────────────────────────────────
app.layout = html.Div([
    dcc.Location(id="url-root", refresh=True),
    dcc.Store(id="store-auth", storage_type="session"),
    html.Div(id="root-content"),
])


@callback(
    Output("root-content", "children"),
    Input("url-root", "pathname"),
    Input("store-auth", "data"),
)
def render_root(pathname, auth_data):
    # Allow /login path regardless
    if pathname == "/login":
        return login_layout()
    # Check session token
    token = None
    try:
        token = session.get("token")
    except RuntimeError:
        pass
    if not token:
        # Also check dcc.Store fallback
        if auth_data and auth_data.get("token"):
            token = auth_data.get("token")
    if not token:
        return login_layout()
    return main_layout()


# ─────────────────────────────────────────────────────────────────────────────
# Login callback
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("store-auth", "data"),
    Output("login-error", "children"),
    Output("login-error", "is_open"),
    Output("url-root", "href"),
    Input("btn-login", "n_clicks"),
    State("input-email", "value"),
    State("input-password", "value"),
    prevent_initial_call=True,
)
def handle_login(n_clicks, email, password):
    if not n_clicks:
        return no_update, no_update, no_update, no_update
    if not email or not password:
        return no_update, "Please enter your email and password.", True, no_update
    try:
        from supabase import create_client
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        resposta = supabase.auth.sign_in_with_password({"email": email, "password": password})
        token    = resposta.session.access_token
        user_email = resposta.user.email
        # Store in Flask server-side session
        session["token"]      = token
        session["user_email"] = user_email
        return {"token": token, "email": user_email}, "", False, "/"
    except Exception:
        return no_update, "Incorrect email or password.", True, no_update


# ─────────────────────────────────────────────────────────────────────────────
# Logout callback
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("store-auth", "data", allow_duplicate=True),
    Output("url-root", "href", allow_duplicate=True),
    Input("btn-logout", "n_clicks"),
    prevent_initial_call=True,
)
def handle_logout(n_clicks):
    if not n_clicks:
        return no_update, no_update
    session.clear()
    return {}, "/login"


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=8050)
