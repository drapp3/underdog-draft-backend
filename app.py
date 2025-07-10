import os
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import json
import csv
from io import StringIO

app = Flask(__name__)
CORS(app)

# Database setup - Railway provides DATABASE_URL automatically
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///draft.db')
if app.config['SQLALCHEMY_DATABASE_URI'].startswith('postgres://'):
    app.config['SQLALCHEMY_DATABASE_URI'] = app.config['SQLALCHEMY_DATABASE_URI'].replace('postgres://', 'postgresql://', 1)

db = SQLAlchemy(app)

# Database Models
class Player(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    appearance_id = db.Column(db.String(100), unique=True)
    name = db.Column(db.String(100))
    position = db.Column(db.String(10))
    team = db.Column(db.String(10))
    projection = db.Column(db.Float)
    rank = db.Column(db.Integer)
    adp = db.Column(db.Float)

class DraftPick(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    draft_id = db.Column(db.String(100))
    user_id = db.Column(db.String(100))
    player_appearance_id = db.Column(db.String(100))
    pick_number = db.Column(db.Integer)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

class ExposureTracking(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(100))
    player_appearance_id = db.Column(db.String(100))
    week = db.Column(db.String(20))
    draft_count = db.Column(db.Integer, default=0)
    exposure_pct = db.Column(db.Float, default=0.0)

# Create tables
with app.app_context():
    db.create_all()

@app.route('/api/players')
def get_players():
    players = Player.query.all()
    return jsonify([{
        'appearance_id': p.appearance_id,
        'name': p.name,
        'position': p.position,
        'team': p.team,
        'projection': p.projection,
        'rank': p.rank,
        'adp': p.adp
    } for p in players])

@app.route('/api/upload-etr', methods=['POST'])
def upload_etr():
    """Upload ETR CSV data"""
    try:
        csv_data = request.json['csv_data']
        csv_file = StringIO(csv_data)
        reader = csv.DictReader(csv_file)
        
        # Clear existing players
        Player.query.delete()
        
        for row in reader:
            player = Player(
                appearance_id=row.get('appearance_id', row.get('id', '')),
                name=row.get('Player', row.get('player_name', '')),
                position=row.get('Position', row.get('Pos', '')),
                team=row.get('Team', ''),
                projection=float(row.get('UD Projection', row.get('Projection', 0))),
                rank=int(row.get('Rank', 999)),
                adp=float(row.get('ADP', 999))
            )
            db.session.add(player)
        
        db.session.commit()
        return jsonify({'success': True, 'count': Player.query.count()})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/draft-pick', methods=['POST'])
def record_pick():
    """Record a draft pick for exposure tracking"""
    data = request.json
    
    pick = DraftPick(
        draft_id=data['draft_id'],
        user_id=data['user_id'],
        player_appearance_id=data['player_appearance_id'],
        pick_number=data['pick_number']
    )
    db.session.add(pick)
    
    # Update exposure
    week = datetime.now().strftime('%Y-W%U')
    exposure = ExposureTracking.query.filter_by(
        user_id=data['user_id'],
        player_appearance_id=data['player_appearance_id'],
        week=week
    ).first()
    
    if not exposure:
        exposure = ExposureTracking(
            user_id=data['user_id'],
            player_appearance_id=data['player_appearance_id'],
            week=week,
            draft_count=0
        )
        db.session.add(exposure)
    
    exposure.draft_count += 1
    
    # Calculate exposure percentage (assuming 150 drafts/week target)
    total_drafts = db.session.query(DraftPick).filter_by(
        user_id=data['user_id']
    ).filter(DraftPick.timestamp >= datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)).count()
    
    exposure.exposure_pct = (exposure.draft_count / max(total_drafts, 1)) * 100
    
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/exposure/<user_id>')
def get_exposure(user_id):
    """Get exposure data for a user"""
    week = datetime.now().strftime('%Y-W%U')
    exposures = ExposureTracking.query.filter_by(user_id=user_id, week=week).all()
    
    return jsonify([{
        'player_appearance_id': e.player_appearance_id,
        'draft_count': e.draft_count,
        'exposure_pct': e.exposure_pct
    } for e in exposures])

@app.route('/api/recommendations', methods=['POST'])
def get_recommendations():
    """Get player recommendations with exposure consideration"""
    data = request.json
    drafted_ids = data.get('drafted_ids', [])
    user_id = data.get('user_id')
    my_team = data.get('my_team', [])
    
    # Get all players
    players = Player.query.all()
    available = [p for p in players if p.appearance_id not in drafted_ids]
    
    # Get user's exposure data
    week = datetime.now().strftime('%Y-W%U')
    exposures = {e.player_appearance_id: e.exposure_pct 
                for e in ExposureTracking.query.filter_by(user_id=user_id, week=week).all()}
    
    # Score players
    recommendations = []
    for player in available:
        score = player.projection
        
        # Reduce score if overexposed (>35%)
        exposure = exposures.get(player.appearance_id, 0)
        if exposure > 35:
            score *= 0.8
        elif exposure > 25:
            score *= 0.9
        
        # Boost for stacks (simplified)
        if any(p['position'] == 'QB' and p['team'] == player.team for p in my_team):
            if player.position in ['WR', 'TE']:
                score *= 1.1
        
        recommendations.append({
            'player': {
                'appearance_id': player.appearance_id,
                'name': player.name,
                'position': player.position,
                'team': player.team,
                'projection': player.projection,
                'rank': player.rank,
                'adp': player.adp
            },
            'score': score,
            'exposure_pct': exposure
        })
    
    # Sort by score
    recommendations.sort(key=lambda x: x['score'], reverse=True)
    
    return jsonify(recommendations[:20])

@app.route('/api/health')
def health():
    return jsonify({'status': 'healthy', 'players': Player.query.count()})

if __name__ == '__main__':
    app.run(debug=True, port=5000)