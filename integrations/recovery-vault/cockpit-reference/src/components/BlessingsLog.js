import React from 'react';

const BlessingsLog = ({ shrineBlessings }) => {
  const formatTime = (timestamp) => new Date(timestamp).toLocaleTimeString();
  const recentBlessings = shrineBlessings.slice(-5).reverse();
  return <>
    <h3>Recent Blessings</h3>
    <div className="blessings-list">
      {recentBlessings.map((blessing, index) => <div key={`${blessing.timestamp}-${index}`} className="blessing-item">
        <span>Shrine {blessing.shrine}</span><span>+{blessing.xp} XP</span><span>{formatTime(blessing.timestamp)}</span>
      </div>)}
      {shrineBlessings.length === 0 && <div className="no-blessings">No shrine blessings yet. Start exploring!</div>}
    </div>
  </>;
};
export default BlessingsLog;
